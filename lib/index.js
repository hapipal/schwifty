'use strict';

const Path = require('path');
const Objection = require('objection');
const Knex = require('knex');
const Hoek = require('hoek');
const Joi = require('joi');
const Items = require('items');
const Migrator = require('./migrator');
const Schema = require('./schema');
const Package = require('../package.json');

const internals = {};

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

exports.Model = class SchwiftyModel extends Objection.Model {

    static get joiSchema() {}

    // Caches schema, with and without optional keys
    // Will create _schemaMemo and _optionalSchemaMemo properties
    static getJoiSchema(patch) {

        const schema = this._schemaMemo = this._schemaMemo || this.joiSchema;

        if (patch) {
            const patchSchema = this._patchSchemaMemo = this._patchSchemaMemo || internals.patchSchema(schema);
            return patchSchema;
        }

        return schema;
    }

    // Will create _jsonAttributesMemo properties
    static get jsonAttributes() {

        if (this._jsonAttributesMemo) {
            return this._jsonAttributesMemo;
        }

        const joiSchema = this.getJoiSchema();

        if (!joiSchema) {
            return null;
        }

        const schemaKeyDescs = joiSchema.describe().children || {};

        // Setting this._jsonAttributesMemo here.
        this.jsonAttributes = Object.keys(schemaKeyDescs).filter((field) => {

            const type = schemaKeyDescs[field].type;

            // These are the joi types we want to be parsed/serialized as json
            return (type === 'array') || (type === 'object');
        });

        return jsonAttributes;
    }

    /*
    This is here as a necessity because classes can't have
    a getter without the setter for a prop. Schwifty's Model
    classes don't implement a setter for jsonAttributes.

    behold. */
    static set jsonAttributes(value) {

        this._jsonAttributesMemo = value || [];
    }

    static parseJoiValidationError(validation) {

        return validation.error.details;
    }

    $validate(json, options) { // Note, in objection v0.7.x there is a new Validator interface

        json = json || this.$parseJson(this.$toJson(true));
        options = options || {};

        let joiSchema = this.constructor.getJoiSchema(options.patch);

        if (!joiSchema || options.skipValidation) {
            return json;
        }

        // Allow modification of schema, setting of options, etc.
        joiSchema = this.$beforeValidate(joiSchema, json, options);

        const validation = joiSchema.validate(json);

        if (validation.error) {
            const errors = SchwiftyModel.parseJoiValidationError(validation);
            throw new Objection.ValidationError(errors);
        }

        json = validation.value;

        this.$afterValidate(json, options);

        return json;
    }
};

internals.patchSchema = (schema) => {

    if (!schema) {
        return;
    }

    const keys = Object.keys(schema.describe().children || {});

    // Make all keys optional, do not enforce defaults

    if (keys.length) {
        schema = schema.optionalKeys(keys);
    }

    return schema.options({ noDefaults: true });
};
