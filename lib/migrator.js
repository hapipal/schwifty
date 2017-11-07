'use strict';

const Fs = require('fs');
const Path = require('path');
const Hoek = require('hoek');
const Tmp = require('tmp');
const Util = require('util');

const internals = {
    SUPPORTED_EXTENSIONS: ['.co', '.coffee', '.eg', '.iced', '.js', '.litcoffee', '.ls', '.ts'] // from knex
};

exports.migrate = async (knexGroups, defaultKnex, rollback) => {

    const knexMigrations = new Map();

    // Compile migration info per knex instance

    for (let i = 0; i < knexGroups.length; ++i) {
        const knexGroup = knexGroups[i];
        const migrationsDir = knexGroup.migrationsDir;  // Already normalized to abs path

        if (!migrationsDir) {
            continue;
        }

        const knex = knexGroup.knex || defaultKnex;

        Hoek.assert(knex, 'Cannot specify a migrations directory without an available knex instance.');

        if (!knexMigrations.has(knex)) {
            knexMigrations.set(knex, {});
        }

        const migrationsDirs = knexMigrations.get(knex);

        migrationsDirs[migrationsDir] = true;
    }

    // For each knex instance
    for (const migration of knexMigrations) {
        await internals.executeMigration(migration, rollback);
    }
};

internals.executeMigration = async (migration, rollback) => {

    const knex = migration[0];
    const migrationDirs = Object.keys(migration[1]);

    // Promisifying callback-style functions at runtime allows us to monkey-patch these methods in our tests to simulate errors, see /test/index.js, migrations tests usage of Fs.readdir and Tmp.dir
    const { tmpPath, tmpCleanup } = await internals.tmpDir({ unsafeCleanup: true });

    try {

        await Promise.all(
            migrationDirs.map((migrationDir) => internals.symlinkMigrationFiles(migrationDir, tmpPath))
        );

        const relMigrationsDir = Path.relative(process.cwd(), tmpPath);
        const latestOrRollback = rollback ? 'rollback' : 'latest';

        await knex.migrate[latestOrRollback]({ directory: relMigrationsDir });
    }
    finally {
        // Any errors in the try block will still be thrown
        // Cleanup the temp dir (remove it _recursively_ due to unsafeCleanup option)
        tmpCleanup();
    }
};

internals.symlinkMigrationFiles = async (migrationDir, tmpPath) => {

    const migrationFiles = await Util.promisify(Fs.readdir)(migrationDir);

    await Promise.all(
        migrationFiles.map((file) => internals.createSymlink(file, { migrationDir, tmpPath }))
    );
};

internals.createSymlink = async (migrationFile, { migrationDir, tmpPath }) => {

    if (internals.SUPPORTED_EXTENSIONS.indexOf(Path.extname(migrationFile)) === -1) {
        return;
    }

    const file = Path.join(migrationDir, migrationFile);
    const link = Path.join(tmpPath, migrationFile);

    await Util.promisify(Fs.symlink)(file, link);
};

// Special promisification of Tmp.dir() since it callsback with two values
internals.tmpDir = (opts) => {

    return new Promise((resolve, reject) => {

        Tmp.dir(opts, (err, tmpPath, tmpCleanup) => {

            if (err) {
                return reject(err);
            }

            return resolve({ tmpPath, tmpCleanup });
        });
    });
};
