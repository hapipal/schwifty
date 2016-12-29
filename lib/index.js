'use strict';

const Objection = require('objection');
const Model = Objection.Model;
const Knex = require('knex');

const Path = require('path');
const Hoek = require('hoek');
const Joi = require('joi');
const Schema = require('./schema');
const Package = require('../package.json');
const Items = require('items');

const internals = {};

exports.register = (server, options, next) => {

    Joi.assert(options, Schema.plugin, 'Bad plugin options passed to schwifty.');

    const rootState = internals.state(server.root);

    let userOptions = Hoek.shallow(options);

    if (options.models) {
        userOptions.models = options.models;
    }

    if (!rootState.setup) {

        rootState.collector = {
            models: {},
            teardownOnStop: null // Not set, effectively defaults true
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

    userOptions = internals.registrationConfig(userOptions);
    server.root.schwifty(userOptions);

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

    // $beforeInsert() {
    //   this.createdAt = new Date().toISOString();
    // };

    // $beforeUpdate() {
    //   this.updatedAt = new Date().toISOString();
    // };

    static parseValidationError(err) {

        // Implement this if you'd like to further parse Joi's error.details
        return err;
    }

    $validate(json, options) {

        if (!json) {
            // eslint complains about setting json to 'this'
            const self = this;
            json = self;
        }

        if (!options) {
            options = {};
        }

        const ModelClass = this.constructor;

        const joiSchema = ModelClass.schema;

        if (!joiSchema || options.skipValidation) {
            return json;
        }

        let validation = Joi.validate(json, joiSchema);

        if (validation.error) {

            throw new Objection.ValidationError(SchwiftyModel.parseValidationError(validation.error.details));
        }

        validation = validation.value;
        this.$afterValidate(validation, options);

        return validation;
    }
};

internals.initialize = function (server, next) {

    const rootCollector = internals.state(server.root).collector;

    Object.keys(rootCollector.knexGroups).forEach((key) => {

        const knexGroup = rootCollector.knexGroups[key];
        const models = knexGroup.models;

        models.forEach((modelName) => {

            modelName = modelName.toLowerCase();
            const model = rootCollector.models[modelName];
            const modelKnexed = model.bindKnex(knexGroup.knex);
            rootCollector.models[modelName] = modelKnexed;
        });
    });

    return next();
};

internals.stop = function (server, next) {

    const rootCollector = internals.state(server.root).collector;

    // Do not teardown if specifically asked not to
    if (rootCollector.teardownOnStop === false) {
        return next();
    }

    const rootKnex = internals.state(server.root).knex;

    const knexConnections = [rootKnex];

    Object.keys(rootCollector.knexGroups).forEach((key) => {

        knexConnections.push(rootCollector.knexGroups[key].knex);
    });

    rootKnex.destroy((err) => {

        // destroy() all other connection pools
        Items.parallel(knexConnections, (item, nxt) => {

            // If the 'item' (a knex) is the default rootKnex
            if (item === rootKnex) {
                return nxt();
            }

            item.destroy(nxt);
        },
        (err) => {

            if (err) {
                throw new Error(err);
            }
            return next();
        });
    });
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

        // Classnames are often first-capital
        id = id.toLowerCase();
        Hoek.assert(!rootCollector.models[id], `Model definition with tableName "${id}" has already been registered.`);
        rootCollector.models[id] = userConfig.models[index];

        Hoek.assert(rootCollector.models[id].tableName, 'Model definition must have "static get tableName(){ return \'myTableName\' }"');
    });


    /*
        A knexGroup is a knexConfig db connection plus the models that are going there,
        the default is the root server's connection.
    */
    const knexGroup = {
        models: [],
        knex: {}
    };

    const state = internals.state(this);

    if (userConfig.knexConfig && typeof userConfig.knexConfig !== 'undefined') {
        Hoek.assert(typeof state.knexGroupId === 'undefined', 'Only one knexConfig allowed per server or plugin');
    }

    // Check if this state already has a knexGroup associated with it
    if (state.knexGroupId) {

        // The knexGroupId exists so add to models already there, also no need to continue so return here
        const models = rootCollector.knexGroups[state.knexGroupId].models;
        rootCollector.knexGroups[state.knexGroupId].models = models.concat(modelIds);
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
    rootCollector.knexGroups = rootCollector.knexGroups || {};

    const randId = internals.randomId();
    state.knexGroupId = randId;

    rootCollector.knexGroups[randId] = knexGroup;
};

internals.models = (serverFrom, realmPath) => {

    return function (all) {

        const rootCollector = internals.state(serverFrom(this).root).collector;

        if (Object.keys(rootCollector.models).length === 0) {
            return {};
        }

        if (all) {
            return rootCollector.models;
        }

        const modelObj = {};
        const knexGroupId = Hoek.reach(this, `${realmPath}.plugins.schwifty.knexGroupId`);

        const models = rootCollector.knexGroups[knexGroupId].models;

        for (let i = 0; i < models.length; ++i) {
            const modelName = models[i].toLowerCase();
            modelObj[modelName] = rootCollector.models[modelName];
        }

        return modelObj;
    };
};

internals.knex = function (serverFrom, realmPath) {

    return function () {

        const rootCollector = internals.state(serverFrom(this).root).collector;
        const knexGroupId = Hoek.reach(this, `${realmPath}.plugins.schwifty.knexGroupId`);
        return rootCollector.knexGroups[knexGroupId].knex;
    };
};

internals.randomId = () => {

    // new Date().getTime() with 2 random letters on the end should be sufficient
    const alph = 'abcdefghijklmnopqrstuvwxyz';
    let randId = new Date().getTime();
    randId += alph.charAt(Math.floor(Math.random() * alph.length));
    randId += alph.charAt(Math.floor(Math.random() * alph.length));

    return randId;
};

internals.state = (srv) => {

    const state = srv.realm.plugins.schwifty = srv.realm.plugins.schwifty || {};
    return state;
};
