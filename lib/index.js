'use strict';

const Objection = require('objection');
const Model = Objection.Model;
const Knex = require('knex');

const Path = require('path');
const Hoek = require('hoek');
const Joi = require('joi');
const Schema = require('./schema');
const Package = require('../package.json');

// const SchwiftyMigration = require('schwifty-migration');

const internals = {};

exports.register = function (server, options, next) {

    Joi.assert(options, Schema.plugin, 'Bad plugin options passed to schwifty.');

    console.log(options);

    const rootState = internals.state(server.root);

    internals.state(server).dir = options.dir;
    const knexFile = options.knexFile;

    if (options.model) {
        knexFile = options.model;
    }

    let knex;

    try {
        knex = Knex(knexFile[process.env.NODE_ENV]);
    }
    catch (err) {
        return next(err);
    }

    internals.state(server).knex = knex;

    if (!rootState.setup) {

        rootState.collector = {
            models: {},
            teardownOnStop: null // Not set, effectively defaults true
        };

        // Here's the ORM!

        server.decorate('server', 'schwifty', internals.schwifty);
        server.decorate('server', 'models', internals.models((ctx) => ctx, 'realm'));
        server.decorate('request', 'models', internals.models((ctx) => ctx.server, 'route.realm'));
        server.decorate('server', 'knex', knex);
        server.decorate('request', 'knex', knex);
        server.ext('onPreStart', internals.initialize);
        server.ext('onPostStop', internals.stop);

        rootState.setup = true;
    };

    // Decide whether server stop should teardown

    const collector = rootState.collector;

    if (typeof options.teardownOnStop !== 'undefined') {
        Hoek.assert(collector.teardownOnStop === null, 'Schwifty\'s teardownOnStop option can only be specified once.');
        collector.teardownOnStop = options.teardownOnStop;
    }

    const config = internals.registrationConfig(knexFile);
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

        const joiSchema = ModelClass.schema;

        if (!joiSchema || options.skipValidation) {
            return json;
        }

        let validation = this.tryValidate(joiSchema, json);

        if (validation.error) {
            throw new Objection.ValidationError(this.parseValidationError(validation.error.message));
        }
        else {
            validation = validation.value;
            this.$afterValidate(validation, options);
        }

        return validation;
    }
};

internals.initialize = function (server, next) {

    const collector = internals.state(server.root).collector;

    const modelsAsArray = [];

    Object.keys(collector.models).forEach((id) => {

        let model = collector.models[id];
        model = model.bindKnex(internals.state(server).knex);
        collector.models[id] = model;
        modelsAsArray.push(model);
    });


    next();

    // SchwiftyMigration.initModels(modelsAsArray, internals.state(server).knex, internals.state(server).dir, server, (err, res) => {

    //     if(err) {
    //         throw new Error(err);
    //     }

        // next();
    // });
};

internals.stop = function (server, next) {

    const collector = internals.state(server.root).collector;

    // Do not teardown if specifically asked not to
    if (collector.teardownOnStop === false) {
        return next();
    }

    return internals.state(server).knex.destroy(next);
};

internals.schwifty = function (config) {

    let isModels = false;

    // Array of models, coerce to config
    if (Array.isArray(config)) {
        config = Joi.validate(config, Schema.schwifty);
        isModels = true;
    }
    else {

        // Sim a Joi validation structure for the upcoming if / else
        config = {
            error: null,
            value: config
        };
    }

    if (config.error) {
        throw new Objection.ValidationError(this.parseValidationError(config.error.message));
    }
    else {
        config = config.value;
    }

    if (isModels === true) {
        config = { models: config };
    }

    // Apply empty defaults
    config.models = config.models || [];

    // Collect models ensuring no dupes
    const collector = internals.state(this.root).collector;
    const modelIds = config.models.map((model) => new model().constructor.name);

    modelIds.forEach((id, index) => {

        // Classnames are often first-capital
        id = String(id).toLowerCase();
        Hoek.assert(!collector.models[id], `Model definition with identity "${id}" has already been registered.`);
        collector.models[id] = config.models[index];

        Hoek.assert(collector.models[id].tableName, 'Model definition must have "static get tableName(){ return \'myTableName\' }"');
    });

    // If all went well, track which models belong to which realms
    const state = internals.state(this);
    state.models = (state.models || []).concat(modelIds);
};

internals.models = (serverFrom, realmPath) => {

    return function (all) {

        const rootCollector = internals.state(serverFrom(this).root).collector;

        if (!rootCollector.models) {
            return {};
        }

        if (all) {
            return rootCollector.models;
        }

        const modelObj = {};
        const models = Hoek.reach(this, `${realmPath}.plugins.schwifty.models`) || [];

        for (let i = 0; i < models.length; ++i) {
            const modelName = models[i].toLowerCase();
            modelObj[modelName] = rootCollector.models[modelName];
        }

        return modelObj;
    };
};

internals.state = (srv) => {

    const state = srv.realm.plugins.schwifty = srv.realm.plugins.schwifty || {};
    return state;
};
