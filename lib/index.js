'use strict';

const Os = require('os');
const Path = require('path');
const Knex = require('knex');
const Hoek = require('hoek');
const Toys = require('toys');
const Joi = require('joi');
const Items = require('items');
const Migrator = require('./migrator');
const SchwiftyModel = require('./model');
const Schema = require('./schema');
const Package = require('../package.json');

const internals = {};

exports.Model = SchwiftyModel;
exports.assertCompatible = (A, B, msg) => {

    const isExtension = (A.prototype instanceof B) || (B.prototype instanceof A);
    const nameMatches = A.name === B.name;                // Will appear by the same name on `server.models()` (plugin compat)
    const tablenameMatches = A.tableName === B.tableName; // Will touch the same table in the database (query compat)

    Hoek.assert(isExtension && nameMatches && tablenameMatches, msg || 'Models are incompatible.  One model must extend the other, they must have the same name, and share the same tableName.');
};

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

    const config = internals.registrationConfig(options, server.root);
    server.root.schwifty(config);

    return next();
};

exports.register.attributes = {
    pkg: Package,
    multiple: true
};

// Massage registration config for use with rejoice
internals.registrationConfig = (options, rootServer) => {

    const config = Hoek.shallow(options);

    delete config.teardownOnStop;
    delete config.migrateOnStart;

    // Resolve models

    if (typeof config.models === 'string') {
        if (Path.isAbsolute(config.models)) {
            config.models = require(config.models);
        }
        else {
            const relativeTo = rootServer.realm.settings.files.relativeTo || '';
            config.models = require(Path.resolve(relativeTo, config.models));       // Path.resolve() defaults to cwd as base
        }
    }

    return config;
};

internals.initialize = (server, next) => {

    const rootState = internals.state(server.root);
    const collector = rootState.collector;
    const rootKnex = Hoek.reach(rootState, 'knexGroup.knex') || null;

    // Check for invalid model configuration
    let modelErrors = Object.keys(collector.models).map((modelName) => {

        const Model = collector.models[modelName];

        return internals.modelErrors(Model, modelName);
    });

    modelErrors = Hoek.flatten(modelErrors);

    if (modelErrors.length) {
        const errorMessages = modelErrors.map((e) => e.message).join(Os.EOL);
        return next(new Error(errorMessages));
    }

    collector.knexGroups.forEach((knexGroup) => {

        const models = knexGroup.models;
        const knex = knexGroup.knex || rootKnex;

        models.forEach((modelName) => {

            const Model = collector.models[modelName];

            collector.models[modelName] = (knex && !Model.knex()) ? Model.bindKnex(knex) : Model;
        });
    });

    const knexes = internals.getKnexes(collector.knexGroups);
    const ping = (knex, cb) => {

        return knex.queryBuilder().select(knex.raw('1')).asCallback((err) => {

            if (err) {
                const models = collector.models;
                const modelNames = Object.keys(models).filter((name) => {

                    return models[name].knex() === knex;
                });

                // Augment original error message

                const quoted = (x) => `"${x}"`;

                let message = 'Could not connect to database using schwifty knex instance';
                message += modelNames.length ? ` for models: ${modelNames.map(quoted).join(', ')}.` : '.';
                err.message = (message + (err.message ? ': ' + err.message : ''));

                return cb(err);
            };

            return cb();
        });
    };

    // Ping each knex connection

    Items.parallel(knexes, ping, (err) => {

        if (err) {
            return next(err);
        }

        // Maybe run migrations

        if (!collector.migrateOnStart) {
            return next();
        }

        const rollback = (collector.migrateOnStart === 'rollback');

        Migrator.migrate(collector.knexGroups, rootKnex, rollback, next);
    });
};

internals.modelErrors = (Model, modelName) => {

    const relations = new Set(Object.keys(Model.getRelations()));
    const schema = new Set(Object.keys(Model.getJoiSchema().describe().children));

    // Compute the intersection between the two sets.  Any collision is an error.
    const intersection = Array.from(relations).filter((x) => schema.has(x));

    if (intersection.length > 0){

        if (intersection.length > 1) {
            const collisionError = new Error('Model ' + modelName + ' attributes ' + intersection.join(', ') + ' conflict with relations of the same names.  Names must be unique.');
            return [collisionError];
        }

        const collisionError = new Error('Model ' + modelName + ' attribute ' + intersection.toString() + ' conflicts with relation of the same name.  Names must be unique.');
        return [collisionError];
    }

    return [];
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
            migrationsDir: null,    // If present, will be resolved to an absolute path
            knex: null
        };

        collector.knexGroups.push(state.knexGroup);
    }

    // Set plugin's migrations dir if available and allowed

    if (typeof config.migrationsDir !== 'undefined') {
        Hoek.assert(state.knexGroup.migrationsDir === null, 'Schwifty\'s migrationsDir plugin option can only be specified once per plugin.');
        const relativeTo = this.realm.settings.files.relativeTo || '';
        state.knexGroup.migrationsDir = Path.resolve(relativeTo, config.migrationsDir);
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

internals.models = (getServer, realmPath) => {

    const getKnexGroup = Toys.reacher(`${realmPath}.plugins.schwifty.knexGroup`);

    return function (all) {

        const server = getServer(this);
        const collector = internals.state(server.root).collector;

        if (all) {
            return collector.models;
        }

        const knexGroup = getKnexGroup(this);

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

internals.knex = (getServer, realmPath) => {

    const getFromPlugin = Toys.reacher(`${realmPath}.plugins.schwifty.knexGroup.knex`);
    const getFromRoot = Toys.reacher('realm.plugins.schwifty.knexGroup.knex');

    return function () {

        return getFromPlugin(this) ||
               getFromRoot(getServer(this).root) ||
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

    const knexes = internals.getKnexes(collector.knexGroups);

    Items.parallel(knexes, (knex, nxt) => knex.destroy(nxt), next);
};

internals.getKnexes = (knexGroups) => {

    const knexes = knexGroups
        .map((knexGroup) => knexGroup.knex)
        .filter((maybeKnex) => !!maybeKnex);

    return internals.uniqueObjects(knexes);
};

// Dedupes an array of objects
internals.uniqueObjects = (arr) => {

    // Create a Map with arr's objects as keys
    const mapped = new Map(arr.map((obj) => [obj]));

    const uniqueObjects = [];
    mapped.forEach((value, key) => uniqueObjects.push(key));

    return uniqueObjects;
};
