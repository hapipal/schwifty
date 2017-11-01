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
    const { tmpPath, tmpCleanup } = await internals.promisifyTmpDir({ unsafeCleanup: true });

    const directoriesToRead = [];
    const symlinkConfig = {
        tmpPath
    };

    for (const migrationDir of migrationDirs) {
        directoriesToRead.push(internals.readMigrationDir(migrationDir, symlinkConfig));
    }

    try {
        await Promise.all(directoriesToRead);
    }
    catch (err) {

        // Even if our symlinking fails, we need to manually cleanup our temporary directory because
        // the unsafeCleanup: true option we pass to tempDir (Tmp.dir promisified) causes Tmp to not delete the temp directory if it has entries,
        // which it will if we fail partway through
        tmpCleanup();
        throw err;
    }

    const relMigrationsDir = Path.relative(process.cwd(), tmpPath);
    const latestOrRollback = rollback ? 'rollback' : 'latest';

    await knex.migrate[latestOrRollback]({ directory: relMigrationsDir });

    tmpCleanup();

};

internals.readMigrationDir = async (migrationDir, symlinkConfig) => {

    const migrationFiles = await Util.promisify(Fs.readdir)(migrationDir);

    // We store our current migrationDir here and not in the above for...of loop in executeMigration because if assigned there, subsequent iterations of that loop would overwrite the copy of symlinkConfig that the current iteration of readMigrationDir is reading and using to create symlinks
    // So, the created symlinks would use the files read from the current migrationDir, but then the migrationDir from the next iteration, resulting in ENOENT errors
    symlinkConfig.migrationDir = migrationDir;

    const migrationSymlinks = [];

    for (const file of migrationFiles) {
        migrationSymlinks.push(internals.symlinkMigrationFile(file, symlinkConfig));
    }

    await Promise.all(migrationSymlinks);
};

internals.symlinkMigrationFile = async (migrationFile, symlinkConfig) => {

    if (internals.SUPPORTED_EXTENSIONS.indexOf(Path.extname(migrationFile)) === -1) {
        return;
    }

    const file = Path.join(symlinkConfig.migrationDir, migrationFile);
    const link = Path.join(symlinkConfig.tmpPath, migrationFile);

    await Util.promisify(Fs.symlink)(file, link);

};

/**
 * A non-standard one :) Wraps the Tmp.dir method in a promise. We do this manually instead of using Util.promisify as we do with the other callback-style methods
 * because Tmp.dir's callback takes 2 non-error parameters, but Promises fulfill with only a single value and Util.promisify handles this by
 * fulfilling with only the first parameter (the path to the temporary directory), which resulted in us being unable to cleanup our temporary directory because we no longer had access to Tmp's cleanup method
 *
 * @param {object} opts — Options object that Tmp.dir normally expects
 * @return {promise} Promise that, if Tmp.dir succeeds, fulfills with an object containing
 *      - *tmpPath* the path to the new temp directory
 *      - *cleanupCallback* {function} removes the temporary directory when we're done using it
 */
internals.promisifyTmpDir = (opts) => {

    return new Promise((fulfill, reject) => {

        Tmp.dir(opts, (err, path, cleanupCallback) => {

            if (err) {
                throw err;
            }

            fulfill({ tmpPath: path, tmpCleanup: cleanupCallback });

        });

    });
};
