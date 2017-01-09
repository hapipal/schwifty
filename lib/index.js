'use strict';

const Path = require('path');
const Objection = require('objection');
const Knex = require('knex');
const Hoek = require('hoek');
const Joi = require('joi');
const Items = require('items');
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
            knexGroups: []
        };

        // Here's the ORM!

        server.decorate('server', 'schwifty', internals.schwifty);
        server.decorate('server', 'models', internals.models((ctx) => ctx, 'realm'));
        server.decorate('request', 'models', internals.models((ctx) => ctx.server, 'route.realm'));
        server.decorate('server', 'knex', internals.knex('realm'));
        server.decorate('request', 'knex', internals.knex('route.realm'));
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

internals.initialize = function (server, next) {

    const rootCollector = internals.state(server.root).collector;

    rootCollector.knexGroups.forEach((knexGroup) => {

        const models = knexGroup.models;

        models.forEach((modelName) => {

            const model = rootCollector.models[modelName];
            const modelKnexed = model.bindKnex(knexGroup.knex);
            rootCollector.models[modelName] = modelKnexed;
        });
    });

    return next();
};

internals.schwifty = function (config) {

    let isModels = false;
    let userConfig;

    if (Array.isArray(config) || config.prototype instanceof Objection.Model) {

        // Array of models or single passed in
        isModels = true;
        userConfig = config;
    }
    else {
        userConfig = Hoek.shallow(config);
    }

    userConfig = Joi.validate(userConfig, Schema.schwifty);

    // Check for errors
    if (userConfig.error) {
        throw new Error(userConfig.error.message);
    }
    else {
        userConfig = userConfig.value;
    }

    if (isModels === true) {
        userConfig = { models: userConfig };
    }


    userConfig.models = userConfig.models || [];

    // Collect models ensuring no dupes
    const rootCollector = internals.state(this.root).collector;

    const modelIds = userConfig.models.map((model) => new model().constructor.name);


    modelIds.forEach((id, index) => {

        Hoek.assert(!rootCollector.models[id], `Model definition with name ${JSON.stringify(id)} has already been registered.`);

        rootCollector.models[id] = userConfig.models[index];
    });

    // A knexGroup is a knexConfig db connection plus the models that are going there,
    // the default is the root server's connection.
    const knexGroup = {
        models: [],
        knex: null
    };

    const state = internals.state(this);

    if (userConfig.knexConfig && typeof userConfig.knexConfig !== 'undefined') {
        Hoek.assert(typeof state.knexGroup === 'undefined', 'Only one knexConfig allowed per server or plugin');
    }

    // Check if this state already has a knexGroup associated with it

    if (state.knexGroup) {

        // The knexGroup exists so add to models already there, also no need to continue so return here
        state.knexGroup.models = state.knexGroup.models.concat(modelIds);
        return;
    }

    // Handle the knex instance

    if (userConfig.knexConfig) {

        const knexInstance = Knex(userConfig.knexConfig);

        knexGroup.knex = knexInstance;

        // Set the root knex connection if not there
        if (typeof internals.state(this.root).knex === 'undefined') {
            internals.state(this.root).knex = knexInstance;
        }
    }
    else {
        // By default the knex connection is the root server's.
        Hoek.assert(internals.state(this.root).knex, 'Must have root server knexConfig set before adding more models');
        knexGroup.knex = internals.state(this.root).knex;
    }

    // Now keep track of which plugins have which knex connections
    // modelIds is an array
    knexGroup.models = modelIds;

    state.knexGroup = knexGroup;

    rootCollector.knexGroups.push(knexGroup);
};

internals.models = (serverFrom, realmPath) => {

    return function (all) {

        const rootCollector = internals.state(serverFrom(this).root).collector;

        if (Object.keys(rootCollector.models).length === 0) {
            return {};
        }

        const knexGroup = Hoek.reach(this, `${realmPath}.plugins.schwifty.knexGroup`);

        if (all || !knexGroup) {
            return rootCollector.models;
        }

        const modelObj = {};
        const models = knexGroup.models;

        for (let i = 0; i < models.length; ++i) {
            const modelName = models[i];
            modelObj[modelName] = rootCollector.models[modelName];
        }

        return modelObj;
    };
};

internals.knex = (realmPath) => {

    return function () {

        return Hoek.reach(this, `${realmPath}.plugins.schwifty.knexGroup.knex`);
    };
};

internals.state = (srv) => {

    const state = srv.realm.plugins.schwifty = srv.realm.plugins.schwifty || {};
    return state;
};

internals.stop = function (server, next) {

    const rootCollector = internals.state(server.root).collector;

    // Do not teardown if specifically asked not to
    if (rootCollector.teardownOnStop === false) {
        return next();
    }

    const rootKnex = internals.state(server.root).knex;

    const knexConnections = [rootKnex];

    rootCollector.knexGroups.forEach((knexGroup) => {

        const knexConn = knexGroup.knex;

        if (knexConn !== rootKnex) {
            knexConnections.push(knexConn);
        }
    });

    Items.parallel(knexConnections, (item, nxt) => item.destroy(nxt), next);
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

        const jsonAttributes = Object.keys(schemaKeyDescs).filter((field) => {

            const type = schemaKeyDescs[field].type;

            // These are the joi types we want to be parsed/serialized as json
            return (type === 'array') || (type === 'object');
        });

        this._jsonAttributesMemo = jsonAttributes;

        return jsonAttributes;
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
