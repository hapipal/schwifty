'use strict';

const Path = require('path');
const Knex = require('knex');
const Hoek = require('@hapi/hoek');
const Toys = require('@hapipal/toys');
const Joi = require('joi');
const Migrator = require('./migrator');
const SchwiftyModel = require('./model');
const Schema = require('./schema');
const Helpers = require('./helpers');
const Package = require('../package.json');

const internals = {};

exports.Model = SchwiftyModel;

exports.migrationsStubPath = Path.join(__dirname, 'migration.stub');

exports.assertCompatible = (A, B, msg) => {

    const isExtension = (A.prototype instanceof B) || (B.prototype instanceof A);
    const nameA = Helpers.getName(A);
    const nameB = Helpers.getName(B);
    const nameMatches = nameA === nameB;                  // Will appear by the same name on `server.models()` (plugin compat)
    const tablenameMatches = A.tableName === B.tableName; // Will touch the same table in the database (query compat)

    Hoek.assert(isExtension && nameMatches && tablenameMatches, msg || 'Models are incompatible.  One model must extend the other, they must have the same name, and share the same tableName.');
};

exports.sandbox = Helpers.symbols.sandbox;

exports.bindKnex = Helpers.symbols.bindKnex;

exports.plugin = {
    pkg: Package,
    multiple: true,
    requirements: {
        hapi: '>=19'
    },
    register: (server, options) => {

        options = Joi.attempt(options, Schema.plugin, 'Bad plugin options passed to schwifty.');

        const rootState = internals.rootState(server.realm);

        if (!rootState.setup) {

            server.decorate('server', 'registerModel', function (models) {

                return internals.registerModel(this.realm, models);
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

        const { collector } = rootState;

        // Decide whether server stop should teardown

        if (typeof options.teardownOnStop !== 'undefined') {
            Hoek.assert(collector.teardownOnStop === null, 'Schwifty\'s teardownOnStop option can only be specified once.');
            collector.teardownOnStop = options.teardownOnStop;
        }

        // Decide whether server start should perform migrations

        if (typeof options.migrateOnStart !== 'undefined') {
            Hoek.assert(collector.migrateOnStart === null, 'Schwifty\'s migrateOnStart option can only be specified once.');
            collector.migrateOnStart = options.migrateOnStart;
        }

        // Handle all configuration related to the plugin/realm registering schwifty

        const realm = server.realm.parent;
        const state = internals.state(realm);

        internals.setNamespaceFromRealm(rootState, realm);

        // Set plugin's migrations dir if available and allowed

        if (typeof options.migrationsDir !== 'undefined') {
            Hoek.assert(state.migrationsDir === null, 'Schwifty\'s migrationsDir plugin option can only be specified once per plugin.');
            const relativeTo = realm.settings.files.relativeTo || '';
            state.migrationsDir = Path.resolve(relativeTo, options.migrationsDir);
            rootState.collector.realmsWithMigrationsDir.add(realm);
        }

        // Record this plugin's knex instance if appropriate

        if (options.knex) {
            Hoek.assert(!state.knex, 'A knex instance/config may be specified only once per server or plugin.');
            state.knex = (typeof options.knex === 'function') ? options.knex : Knex(options.knex);
            rootState.collector.knexes.add(state.knex);
        }
    }
};

internals.initialize = async (server) => {

    const { collector } = internals.rootState(server.realm);

    // Spread realmByModel into a concrete array, so we can safely mutate it while iterating over it
    ([...collector.realmByModel]).forEach(([Model, realm]) => {

        const knex = internals.knex(() => realm)();
        const bindKnex = Helpers.getBindKnex(Model);
        const BoundModel = (knex && bindKnex && !Model.knex()) ? Model.bindKnex(knex) : Model;
        const name = Helpers.getName(Model);
        const sandbox = Helpers.getSandbox(Model);

        collector.realmByModel.delete(Model);
        collector.realmByModel.set(BoundModel, realm);

        if (sandbox) {
            return internals.addModelToRealm(realm, BoundModel, name, { override: true });
        }

        Toys.forEachAncestorRealm(realm, (r) => {

            internals.addModelToRealm(r, BoundModel, name, { override: true });
        });
    });

    const knexes = Array.from(collector.knexes);

    const ping = async (knex) => {

        try {
            await knex.queryBuilder().select(knex.raw('1'));
        }
        catch (err) {

            const modelInfo = [...collector.realmByModel]
                .filter(([Model]) => Model.knex() === knex)
                .map(([Model, realm]) => ({
                    name: Helpers.getName(Model),
                    sandbox: Helpers.getSandbox(Model),
                    namespace: realm.plugin
                }));

            // Augment original error message

            const displayInfo = ({ name, sandbox, namespace }) => `"${name}"${sandbox ? ` (${namespace})` : ''}`;

            let message = 'Could not connect to database using schwifty knex instance';
            message += modelInfo.length ? ` for models: ${modelInfo.map(displayInfo).join(', ')}.` : '.';
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

internals.registerModel = (realm, models) => {

    models = Joi.attempt(models, Schema.registerModel, 'Invalid models passed to server.registerModel().');

    const rootState = internals.rootState(realm);

    internals.setNamespaceFromRealm(rootState, realm);

    models.forEach((Model) => {

        const name = Helpers.getName(Model);
        const sandbox = Helpers.getSandbox(Model);

        Hoek.assert(name, 'Every model class must have a name.');
        Hoek.assert(sandbox || !rootState.models[name], `Model "${name}" has already been registered.`);

        rootState.collector.realmByModel.set(Model, realm);

        if (sandbox) {
            return internals.addModelToRealm(realm, Model, name);
        }

        Toys.forEachAncestorRealm(realm, (r) => {

            internals.addModelToRealm(r, Model, name);
        });
    });
};

internals.models = (getRealm) => {

    return function (namespace) {

        const realm = internals.getRealmFromNamespace(getRealm(this), namespace);

        return internals.state(realm).models;
    };
};

internals.knex = (getRealm) => {

    return function (namespace) {

        const realm = internals.getRealmFromNamespace(getRealm(this), namespace);

        let knex;
        let iterateRealm = realm;

        while (!knex && iterateRealm) {

            const state = internals.state(iterateRealm);

            knex = state.knex;

            // Skip any knexes outside the given namespace that are sandboxed
            if (knex && Helpers.getSandbox(knex) && iterateRealm !== realm) {
                knex = null;
            }

            iterateRealm = iterateRealm.parent;
        }

        return knex || null;
    };
};

internals.getRealmFromNamespace = (realm, namespace) => {

    if (!namespace) {
        return realm;
    }

    if (typeof namespace === 'string') {
        const namespaceSet = internals.rootState(realm).namespaces[namespace];
        Hoek.assert(namespaceSet, `The plugin namespace ${namespace} does not exist.`);
        Hoek.assert(namespaceSet.size === 1, `The plugin namespace ${namespace} is not unique: is that plugin registered multiple times?`);
        const [namespaceRealm] = [...namespaceSet];
        return namespaceRealm;
    }

    return Toys.rootRealm(realm);
};


internals.setNamespaceFromRealm = (rootState, realm) => {

    rootState.namespaces[realm.plugin] = rootState.namespaces[realm.plugin] || new Set();
    rootState.namespaces[realm.plugin].add(realm);

    return rootState;
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

internals.addModelToRealm = (realm, Model, name, { override = false } = {}) => {

    const state = internals.state(realm);
    Hoek.assert(override || !state.models[name], `A model named "${name}" has already been registered in plugin namespace "${realm.plugin}".`);
    state.models[name] = Model;
};

internals.state = (realm) => {

    const state = Toys.state(realm, 'schwifty');

    if (Object.keys(state).length === 0) {
        Object.assign(state, {
            models: {},
            migrationsDir: null,    // If present, will be resolved to an absolute path
            knex: null
        });
    }

    return state;
};

internals.rootState = (realm) => {

    const rootRealm = Toys.rootRealm(realm);
    const state = internals.state(rootRealm);

    if (!state.hasOwnProperty('setup')) {
        Object.assign(state, {
            setup: false,
            namespaces: {},
            collector: {
                teardownOnStop: null,   // Not set, effectively defaults true
                migrateOnStart: null,   // Not set, effectively defaults false
                realmByModel: new Map(),
                realmsWithMigrationsDir: new Set(),
                knexes: new Set()
            }
        });
    }

    return state;
};
