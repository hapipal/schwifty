'use strict';

const Path = require('path');
const Knex = require('knex');
const Hoek = require('hoek');
const Joi = require('joi');
const Items = require('items');
const Migrator = require('./migrator');
const SchwiftyModel = require('./model');
const Schema = require('./schema');
const Package = require('../package.json');

const internals = {};

exports.Model = SchwiftyModel;

exports.register = (server, options, next) => {

    Joi.assert(options, Schema.plugin, 'Bad plugin options passed to schwifty.');

    const rootState = internals.state(server.root);

    if (!rootState.setup) {

        rootState.collector = {
            models: {},
            teardownOnStop: null, // Not set, effectively defaults true
            migrateOnStart: null, // Not set, effectively defaults false
            knexGroups: []
        };

        // Here's the ORM!

        server.decorate('server', 'schwifty', internals.schwifty);
        server.decorate('server', 'models', internals.models((ctx) => ctx, 'realm'));
        server.decorate('request', 'models', internals.models((ctx) => ctx.server, 'route.realm'));
        server.decorate('server', 'knex', internals.knex((ctx) => ctx, 'realm'));
        server.decorate('request', 'knex', internals.knex((ctx) => ctx.server, 'route.realm'));
        server.ext('onPreStart', internals.initialize);
        server.ext('onPostStop', internals.stop);

        rootState.setup = true;
    };

    const rootCollector = rootState.collector;

    // Decide whether server stop should teardown

    if (typeof options.teardownOnStop !== 'undefined') {
        Hoek.assert(rootCollector.teardownOnStop === null, 'Schwifty\'s teardownOnStop option can only be specified once.');
        rootCollector.teardownOnStop = options.teardownOnStop;
    }

    // Decide whether server start should perform migrations

    if (typeof options.migrateOnStart !== 'undefined') {
        Hoek.assert(rootCollector.migrateOnStart === null, 'Schwifty\'s migrateOnStart option can only be specified once.');
        rootCollector.migrateOnStart = options.migrateOnStart;
    }

    const config = internals.registrationConfig(options);
    server.root.schwifty(config);

    return next();
};

exports.register.attributes = {
    pkg: Package,
    multiple: true
};

// Massage registration config for use with rejoice
internals.registrationConfig = (options) => {

    const config = Hoek.shallow(options);

    delete config.teardownOnStop;
    delete config.migrateOnStart;

    // Resolve models

    if (typeof config.models === 'string') {
        if (Path.isAbsolute(config.models)) {
            config.models = require(config.models);
        }
        else {
            config.models = require(Path.resolve(process.cwd(), config.models));
        }
    }

    return config;
};

internals.initialize = (server, next) => {

    const rootState = internals.state(server.root);
    const collector = rootState.collector;
    const rootKnex = Hoek.reach(rootState, 'knexGroup.knex') || null;

    collector.knexGroups.forEach((knexGroup) => {

        const models = knexGroup.models;
        const knex = knexGroup.knex || rootKnex;

        models.forEach((modelName) => {

            const Model = collector.models[modelName];

            collector.models[modelName] = knex ? Model.bindKnex(knex) : Model;
        });
    });

    if (!collector.migrateOnStart) {
        return next();
    }

    const rollback = (collector.migrateOnStart === 'rollback');

    Migrator.migrate(collector.knexGroups, rootKnex, rollback, next);
};

internals.schwifty = function (config) {

    config = Joi.attempt(config, Schema.schwifty);

    // Array of models, coerce to config
    if (Array.isArray(config)) {
        config = { models: config };
    }

    // Apply empty defaults
    config.models = config.models || [];

    const state = internals.state(this);
    const collector = internals.state(this.root).collector;

    // A knexGroup is a knex instance plus the models that use it
    // Give one to this plugin if it doesn't have it, then add it to the collector

    if (!state.knexGroup) {
        state.knexGroup = {
            models: [],
            migrationsDir: null,
            knex: null
        };

        collector.knexGroups.push(state.knexGroup);
    }

    // Set plugin's migrations dir if available and allowed

    if (typeof config.migrationsDir !== 'undefined') {
        Hoek.assert(state.knexGroup.migrationsDir === null, 'Schwifty\'s migrationsDir plugin option can only be specified once per plugin.');
        state.knexGroup.migrationsDir = config.migrationsDir;
    }

    // Collect models ensuring no dupes

    const modelNames = config.models.map((Model) => Model.name);

    modelNames.forEach((name, index) => {

        Hoek.assert(!collector.models[name], `Model "${name}" has already been registered.`);
        collector.models[name] = config.models[index];
    });

    // Record this plugin's models
    state.knexGroup.models = state.knexGroup.models.concat(modelNames);

    // Record this plugin's knex instance if appropriate

    if (config.knex) {
        Hoek.assert(!state.knexGroup.knex, 'A knex instance/config may be specified only once per server or plugin.');
        state.knexGroup.knex = (typeof config.knex === 'function') ? config.knex : Knex(config.knex);
    }
};

internals.models = (serverFrom, realmPath) => {

    return function (all) {

        const server = serverFrom(this);
        const collector = internals.state(server.root).collector;

        if (all) {
            return collector.models;
        }

        const knexGroup = Hoek.reach(this, `${realmPath}.plugins.schwifty.knexGroup`);

        if (!knexGroup) {
            return {};
        }

        const models = {};
        const pluginModelNames = knexGroup.models;

        for (let i = 0; i < pluginModelNames.length; ++i) {
            const modelName = pluginModelNames[i];
            models[modelName] = collector.models[modelName];
        }

        return models;
    };
};

internals.knex = (serverFrom, realmPath) => {

    return function () {

        return Hoek.reach(this, `${realmPath}.plugins.schwifty.knexGroup.knex`) ||
               Hoek.reach(serverFrom(this).root, 'realm.plugins.schwifty.knexGroup.knex') ||
               null;
    };
};

internals.state = (srv) => {

    const state = srv.realm.plugins.schwifty = srv.realm.plugins.schwifty || {};
    return state;
};

internals.stop = function (server, next) {

    const collector = internals.state(server.root).collector;

    // Do not teardown if specifically asked not to
    if (collector.teardownOnStop === false) {
        return next();
    }

    let knexes = collector.knexGroups
        .map((knexGroup) => knexGroup.knex)
        .filter((maybeKnex) => !!maybeKnex);

    knexes = internals.uniqueObjects(knexes);

    Items.parallel(knexes, (knex, nxt) => knex.destroy(nxt), next);
};

// Dedupes an array of objects
internals.uniqueObjects = (arr) => {

    // Create a Map with arr's objects as keys
    const mapped = new Map(arr.map((obj) => [obj]));

    const uniqueObjects = [];
    mapped.forEach((value, key) => uniqueObjects.push(key));

    return uniqueObjects;
};
