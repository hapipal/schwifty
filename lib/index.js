'use strict';

const Path = require('path');
const Knex = require('knex');
const Hoek = require('@hapi/hoek');
const Joi = require('@hapi/joi');
const Toys = require('toys');
const Migrator = require('./migrator');
const SchwiftyModel = require('./model');
const Schema = require('./schema');
const Package = require('../package.json');

const internals = {};

exports.Model = SchwiftyModel;

exports.migrationsStubPath = Path.join(__dirname, 'migration.stub');

exports.assertCompatible = (A, B, msg) => {

    const isExtension = (A.prototype instanceof B) || (B.prototype instanceof A);
    const nameMatches = A.name === B.name;                // Will appear by the same name on `server.models()` (plugin compat)
    const tablenameMatches = A.tableName === B.tableName; // Will touch the same table in the database (query compat)

    Hoek.assert(isExtension && nameMatches && tablenameMatches, msg || 'Models are incompatible.  One model must extend the other, they must have the same name, and share the same tableName.');
};

exports.plugin = {
    pkg: Package,
    multiple: true,
    register: (server, options) => {

        Joi.assert(options, Schema.plugin, 'Bad plugin options passed to schwifty.');

        const parentRealm = server.realm.parent;
        const rootState = internals.rootState(server.realm);

        if (!rootState.setup) {

            rootState.collector = {
                teardownOnStop: null,   // Not set, effectively defaults true
                migrateOnStart: null,   // Not set, effectively defaults false
                realmByModel: new Map(),
                realmsWithMigrationsDir: new Set(),
                knexes: new Set()
            };

            server.decorate('server', 'schwifty', function (config) {

                return internals.schwifty(this.realm, config);
            });
            server.decorate('server', 'models', internals.models((srv) => srv.realm));
            server.decorate('request', 'models', internals.models((request) => request.route.realm));
            server.decorate('toolkit', 'models', internals.models((h) => h.realm));
            server.decorate('server', 'knex', internals.knex((srv) => srv.realm));
            server.decorate('request', 'knex', internals.knex((request) => request.route.realm));
            server.decorate('toolkit', 'knex', internals.knex((h) => h.realm));
            server.ext('onPreStart', internals.initialize);
            server.ext('onPostStop', internals.stop);

            rootState.setup = true;
        }

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

        const config = internals.registrationConfig(options, parentRealm);
        internals.schwifty(parentRealm, config);
    }
};

// Massage registration config
internals.registrationConfig = (options, realm) => {

    const config = { ...options };

    delete config.teardownOnStop;
    delete config.migrateOnStart;

    // Resolve models

    if (typeof config.models === 'string') {
        if (Path.isAbsolute(config.models)) {
            config.models = require(config.models);
        }
        else {
            const relativeTo = realm.settings.files.relativeTo || '';
            config.models = require(Path.resolve(relativeTo, config.models));       // Path.resolve() defaults to cwd as base
        }
    }

    return config;
};

internals.initialize = async (server) => {

    const { collector } = internals.rootState(server.realm);

    collector.realmByModel.forEach((realm, Model) => {

        const knex = internals.knex(() => realm)();
        const BoundModel = (knex && !Model.knex()) ? Model.bindKnex(knex) : Model;

        Toys.forEachAncestorRealm(realm, (r) => {

            const s = internals.state(r);

            s.models[Model.name] = BoundModel;
        });
    });

    const knexes = Array.from(collector.knexes);

    const ping = async (knex) => {

        try {
            await knex.queryBuilder().select(knex.raw('1'));
        }
        catch (err) {

            const models = internals.models(() => server.realm)(true);
            const modelNames = Object.values(models)
                .filter((Model) => Model.knex() === knex)
                .map((Model) => Model.name);

            // Augment original error message

            const quoted = (x) => `"${x}"`;

            let message = 'Could not connect to database using schwifty knex instance';
            message += modelNames.length ? ` for models: ${modelNames.map(quoted).join(', ')}.` : '.';
            err.message = (message + (err.message ? ': ' + err.message : ''));

            throw err;
        }
    };

    // Ping each knex connection
    await Promise.all(knexes.map(ping));

    if (!collector.migrateOnStart) {
        return;
    }

    const migrations = internals.planMigrations(collector.realmsWithMigrationsDir);
    const rollback = (collector.migrateOnStart === 'rollback');

    await Migrator.migrate(migrations, rollback);
};

internals.planMigrations = (realms) => {

    // Compile migration info per knex instance

    const migrations = new Map();

    realms.forEach((realm) => {

        const knex = internals.knex(() => realm)();
        const state = internals.state(realm);

        Hoek.assert(state.migrationsDir, 'Attempting to plan migrations without a migrations directory.  Please file an issue with schwifty.');
        Hoek.assert(knex, 'Cannot specify a migrations directory without an available knex instance.');

        if (!migrations.has(knex)) {
            migrations.set(knex, Object.create(null));
        }

        const migrationsDirs = migrations.get(knex);

        migrationsDirs[state.migrationsDir] = true;
    });

    return migrations;
};

internals.schwifty = (realm, config) => {

    config = Joi.attempt(config, Schema.schwifty);

    // Array of models, coerce to config
    if (Array.isArray(config)) {
        config = { models: config };
    }

    // Apply empty defaults
    config.models = config.models || [];

    const state = internals.state(realm);
    const rootState = internals.rootState(realm);

    config.models.forEach((Model) => {

        Hoek.assert(Model.name, 'Every model class must have a name.');
        Hoek.assert(!rootState.models || !rootState.models[Model.name], `Model "${Model.name}" has already been registered.`);

        rootState.collector.realmByModel.set(Model, realm);
    });

    Toys.forEachAncestorRealm(realm, (r) => {

        const s = internals.state(r);

        if (!s.exists) {
            Object.assign(s, {
                exists: true,
                models: {},
                migrationsDir: null,    // If present, will be resolved to an absolute path
                knex: null
            });
        }

        config.models.forEach((Model) => {

            s.models[Model.name] = Model;
        });
    });

    // Set plugin's migrations dir if available and allowed

    if (typeof config.migrationsDir !== 'undefined') {
        Hoek.assert(state.migrationsDir === null, 'Schwifty\'s migrationsDir plugin option can only be specified once per plugin.');
        const relativeTo = realm.settings.files.relativeTo || '';
        state.migrationsDir = Path.resolve(relativeTo, config.migrationsDir);
        rootState.collector.realmsWithMigrationsDir.add(realm);
    }

    // Record this plugin's knex instance if appropriate

    if (config.knex) {
        Hoek.assert(!state.knex, 'A knex instance/config may be specified only once per server or plugin.');
        state.knex = (typeof config.knex === 'function') ? config.knex : Knex(config.knex);
        rootState.collector.knexes.add(state.knex);
    }
};

internals.models = (getRealm) => {

    return function (all) {

        const realm = getRealm(this);
        const { models } = all ? internals.rootState(realm) : internals.state(realm);

        return models || {};
    };
};

internals.knex = (getRealm) => {

    return function () {

        let knex;
        let realm = getRealm(this);

        while (!knex && realm) {
            const state = internals.state(realm);
            knex = state.knex;
            realm = realm.parent;
        }

        return knex || null;
    };
};

internals.stop = async (server) => {

    const { collector } = internals.rootState(server.realm);

    // Do not teardown if specifically asked not to
    if (collector.teardownOnStop === false) {
        return;
    }

    const knexes = Array.from(collector.knexes);

    await Promise.all(
        knexes.map((knex) => knex.destroy())
    );
};

internals.state = (realm) => Toys.state(realm, 'schwifty');
internals.rootState = (realm) => Toys.rootState(realm, 'schwifty');
