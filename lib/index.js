'use strict';

const Util = require('util');
const Path = require('path');

const Hoek = require('hoek');
const Toys = require('toys');
const Joi = require('joi');
const Bossy = require('bossy');
const Knex = require('knex');

const Migrator = require('./migrator');
const Helpers = require('./helpers');
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
            server.expose('commands', {
                'migrate:diff': {
                    description: 'Generates a knex migration in your project\'s migrations directory that syncs your database to your schwifty models based upon their current differences.',
                    noDefaultOutput: true,
                    command: internals.migrateDiffCmd
                }
            });

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

        const config = internals.registrationConfig(options, parentRealm);
        internals.schwifty(parentRealm, config);
    }
};

// Massage registration config
internals.registrationConfig = (options, realm) => {

    const config = Hoek.shallow(options);

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

internals.migrateDiffCmd = async (srv, argv, rootDir, ctx) => {

    const { DisplayError, colors, output, options } = ctx;
    const migrateDiff = Helpers.getSchwiftyMigrateDiff();

    if (!migrateDiff) {
        throw new DisplayError(colors.yellow('To use this command please first install `npm install --save-dev schwifty-migrate-diff`'));
    }

    // Parse command line args

    const definition = {
        mode: {
            type: 'string',
            description: 'Determines the types of changes included in the migration. The default "alter" includes both non-destructive and destructive changes (e.g. altering a column type), while "create" only includes non-destructive changes (e.g. adding a new column).',
            valid: ['alter', 'create'],
            default: 'alter'
        }
    };

    const parsedArgs = Bossy.parse(definition, { argv });
    const usage = () => Bossy.usage(definition, 'hpal run schwifty:migrate:diff <migration-name> [--mode alter|create] [--dir <migrations-dir>]', { colors: options.colors });

    if (parsedArgs instanceof Error) {
        throw new DisplayError(`${usage()}\n\n${colors.red(parsedArgs.message)}`);
    }

    const [migrationName, ...others] = parsedArgs._ || [];

    Hoek.assert(migrationName, new DisplayError(`${usage()}\n\n` + colors.red('You must specify a <migration-name>.')));
    Hoek.assert(!others.length, new DisplayError(`${usage()}\n\n` + colors.red('Did you try to specify something other than a <migrations-dir> or <mode>?')));

    // Determine realm's knex and migrationsDir

    const { realmsWithMigrationsDir } = internals.state(srv.realm).collector;
    const realmsWithMigrationsInRoot = Array.from(realmsWithMigrationsDir).filter((realm) => {

        const { migrationsDir } = internals.state(realm);

        return internals.isChildPath(migrationsDir, rootDir);
    });

    Hoek.assert(realmsWithMigrationsInRoot.length > 0, new DisplayError(`At least one migrations directory must be present inside ${rootDir}.`));
    Hoek.assert(realmsWithMigrationsInRoot.length === 1, new DisplayError(`Only one migrations directory supported per project at this time. Please remove one of ${realmsWithMigrationsInRoot.map((realm) => internals.state(realm).migrationsDir).map((dir) => Path.relative(options.cwd, dir)).join(', ')}.`));

    const { knex, migrationsDir } = internals.state(realmsWithMigrationsInRoot[0]);

    const models = Object.values(srv.models())
        .filter((Model) => Model.knex() === knex);

    const { code, file, skippedCols } = await Util.promisify(migrateDiff.genMigrationFile)({
        knex,
        models,
        migrationsDir,
        migrationName,
        mode: parsedArgs.mode
    });

    if (code === migrateDiff.returnCodes.NO_MIGRATION) {
        output(colors.yellow('Couldn\'t find any differences between your models and database, so no migration was generated.'));
    }
    else {
        output(`Generated migration in ${Path.relative(options.cwd, file)}.`);
    }

    return { code, file, skippedCols };
};

internals.isChildPath = (pathA, pathB) => { // A child of B

    const relParts = Path.relative(pathA, pathB).split(Path.sep);
    const partIsDotDot = (part) => part === '..';

    return relParts.every(partIsDotDot);
};
