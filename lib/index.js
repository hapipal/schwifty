'use strict';

const Objection = require('objection');
const Model = Objection.Model;
const Knex = require('knex');

const Path = require('path');
const Hoek = require('hoek');
const Joi = require('joi');
const Schema = require('./schema');
const Package = require('../package.json');

const Joi2KnexSchema = require('./joi2KnexSchema');

const internals = {};

exports.register = function (server, options, next) {

    Joi.assert(options, Schema.plugin, 'Bad plugin options passed to schwifty.');

    const rootState = internals.state(server.root);
    internals.rootState = rootState;

    // For use in internals.createTableIfNotExists
    internals.rootServer = server;

    if (!rootState.setup) {

        rootState.collector = {
            adapters: {},
            connections: {},
            models: {},
            defaults: {},
            teardownOnStop: null // Not set, effectively defaults true
        };

        const env = process.env.NODE_ENV || 'development'

        const serverKnex = Knex(options[env]);

        // Here's the ORM!
        server.decorate('server', 'knex', serverKnex);
        Model.knex(serverKnex);

        server.decorate('server', 'schwifty', internals.schwifty);
        server.decorate('server', 'models', internals.models((ctx) => ctx, 'realm'));
        server.decorate('request', 'models', internals.models((ctx) => ctx.server, 'route.realm'));
        server.ext('onPreStart', internals.initialize);
        server.ext('onPostStop', internals.stop);

        rootState.setup = true;
    };

    // Collect defaults

    const collector = rootState.collector;
    const defaults = options.defaults || {};

    Object.keys(defaults).forEach((key) => {

        Hoek.assert(!collector.defaults[key], `Default for "${key}" has already been set.`);
        collector.defaults[key] = defaults[key];
    });

    // Decide whether server stop should teardown

    if (typeof options.teardownOnStop !== 'undefined') {
        Hoek.assert(collector.teardownOnStop === null, 'Schwifty\'s teardownOnStop option can only be specified once.');
        collector.teardownOnStop = options.teardownOnStop;
    }

    const config = internals.registrationConfig(options);
    server.root.schwifty(config);

    next();
};

exports.register.attributes = {
    pkg: Package,
    multiple: true
};

// Massage registration config for use with rejoice
internals.registrationConfig = (options) => {

    const config = Hoek.shallow(options);
    delete config.defaults;
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

    // Resolve clients

    Object.keys(config.clients || {}).forEach((name) => {

        if (typeof config.clients[name] === 'string') {
            config.clients[name] = require(config.clients[name]);
        }
    });

    return config;
};

exports.Model = class SchwiftyModel extends Model {

    constructor(...args) {
        super(...args);
    }

    // $beforeInsert() {
    //   this.createdAt = new Date().toISOString();
    // };

    // $beforeUpdate() {
    //   this.updatedAt = new Date().toISOString();
    // };

    tryValidate(schema, json) {

        return Joi.validate(json, schema);
    }

    parseValidationError(err) {

        return err;
    }

    $validate(json = this, options = {}) {

        const ModelClass = this.constructor;

        let joiSchema = ModelClass.schema;

        if (!joiSchema || options.skipValidation) {
          return json;
        }

        let validationError = null;

        let validation = this.tryValidate(joiSchema, json);

        if(validation.error) {
            throw new Objection.ValidationError(this.parseValidationError(validation.error.message));
        } else {
            validation = validation.value;
            this.$afterValidate(validation, options);
        }

        return validation;
    }
}

internals.initialize = function (server, next) {

    const collector = internals.state(server.root).collector;

    const modelsInDbPromises = [];

    Object.keys(collector.models).forEach((id) => {

        // Init models into tables if they don't already exist
        modelsInDbPromises.push(internals.createTableIfNotExists(collector.models[id]));
    });

    Promise.all(modelsInDbPromises)
    .then((res) => {

        const config = {
            defaults: collector.defaults
        };

        next();
    });
};

internals.stop = function (server, next) {

    const collector = internals.state(server.root).collector;

    // Do not teardown if specifically asked not to
    if (collector.teardownOnStop === false) {
        return next();
    }

    return Knex.destroy(next);
};

internals.schwifty = function (config) {

    let isModels = false;

    // Array of models, coerce to config
    if (Array.isArray(config)) {
        config = Joi.validate(config, Schema.schwifty);
        isModels = true;
    } else {
        config = Joi.validate(config, Schema.schwifty);
    }

    if(config.error) {
        throw new Objection.ValidationError(this.parseValidationError(config.error.message));
    } else {
        config = config.value;
    }

    if(isModels === true) {
        config = { models: config };
    }

    // Apply empty defaults
    config.models = config.models || [];

    // Collect adapters, connections, models, ensuring no dupes
    const collector = internals.state(this.root).collector;
    const modelIds = config.models.map((model) => new model().constructor.name);

    modelIds.forEach((id, index) => {

        // Classnames are often first-capital
        id = String(id).toLowerCase();
        Hoek.assert(!collector.models[id], `Model definition with identity "${id}" has already been registered.`);
        collector.models[id] = config.models[index];

        Hoek.assert(collector.models[id].tableName, `Model definition must have "static get tableName(){ return 'myTableName' }"`);
    });

    // If all went well, track which models belong to which realms
    const state = internals.state(this);
    state.models = (state.models || []).concat(modelIds);
};

internals.models = (serverFrom, realmPath) => {

    return function (all) {

        const rootCollector = internals.rootState.collector;

        if(!rootCollector.models) {
            return {};
        }

        if (all) {
            return rootCollector.models;
        }

        const models = {};
        const models = Hoek.reach(this, `${realmPath}.plugins.schwifty.models`) || [];

        for (let i = 0; i < models.length; ++i) {
            const modelName = models[i].toLowerCase();
            models[modelName] = rootCollector.models[modelName];
        }

        return models;
    };
};

internals.state = (srv) => {

    const state = srv.realm.plugins.schwifty = srv.realm.plugins.schwifty || {};

    return state;
};

internals.createTableIfNotExists = (model) => {

    let knexSchema;
    let columns;

    if(model.knexSchema) {
        columns = model.knexSchema;
    } else {
        columns = Joi2KnexSchema(model.schema);
    }

    delete columns.id;

    const knexDbSchema = internals.rootServer.knex.schema.createTableIfNotExists(String(model.tableName), function (table) {

        const colNames = Object.keys(columns);

        table.increments();
        table.timestamps();

        Object.keys(columns).forEach((colName) => {

            table[columns[colName]](colName);
        });
    });

    return knexDbSchema;
};

internals.createJoinTablesIfNotExists = (model) => {

}
