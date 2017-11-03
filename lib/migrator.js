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

    const directoriesToRead = [];

    for (const migrationDir of migrationDirs) {
        directoriesToRead.push(internals.symlinkMigrationFiles(migrationDir, tmpPath));
    }

    try {
        await Promise.all(directoriesToRead);
        const relMigrationsDir = Path.relative(process.cwd(), tmpPath);
        const latestOrRollback = rollback ? 'rollback' : 'latest';

        await knex.migrate[latestOrRollback]({ directory: relMigrationsDir });
    } // We don't catch our error because we would throw it anyway if we did; this implicitly lets any error from try propagate and blow things up as we want
    finally {

        // Even if our symlinking fails, we need to manually cleanup our temporary directory because
        // the unsafeCleanup: true option we pass to tempDir (Tmp.dir promisified) causes Tmp to not delete the temp directory if it has entries,
        // which it will if we fail partway through
        tmpCleanup();
    }

};

internals.symlinkMigrationFiles = async (migrationDir, tmpPath) => {

    const migrationFiles = await Util.promisify(Fs.readdir)(migrationDir);

    // We store our current migrationDir here and not in the above for...of loop in executeMigration because if assigned there, subsequent iterations of that loop would overwrite the copy of symlinkConfig that the current iteration of readMigrationDir is reading and using to create symlinks
    // So, the created symlinks would use the files read from the current migrationDir, but then the migrationDir from the next iteration, resulting in ENOENT errors
    const symlinkConfig = { migrationDir, tmpPath };

    const migrationSymlinks = [];

    for (const file of migrationFiles) {
        migrationSymlinks.push(internals.createSymlink(file, symlinkConfig));
    }

    await Promise.all(migrationSymlinks);
};

internals.createSymlink = async (migrationFile, symlinkConfig) => {

    if (internals.SUPPORTED_EXTENSIONS.indexOf(Path.extname(migrationFile)) === -1) {
        return;
    }

    const file = Path.join(symlinkConfig.migrationDir, migrationFile);
    const link = Path.join(symlinkConfig.tmpPath, migrationFile);

    await Util.promisify(Fs.symlink)(file, link);

};

/*
   A non-standard one :) Wraps the Tmp.dir method in a promise that accepts; `opts` is the same configuration options that Tmp.dir normally accepts. We do this manually instead of using Util.promisify as we do with the other callback-style methods
   because Tmp.dir's callback takes 2 non-error parameters, the path of the created directory and a function that cleansup the directory, but Promises fulfill with only a single value and Util.promisify handles this by
   fulfilling with only the first parameter (the path to the temporary directory), which resulted in us being unable to cleanup our temporary directory because we no longer had access to Tmp's cleanup method
*/
internals.tmpDir = (opts) => {

    return new Promise((resolve, reject) => {

        Tmp.dir(opts, (err, path, cleanupCallback) => {

            if (err) {
                // we return here to stop execution of the Promise i.e. don't call resolve, too. Promises save us here i.e. any rejection causes the Promise chain to throw
                // but would execute any non-handler statements prior to resolve, so better to get in a safe habit
                return reject(err);
            }

            resolve({ tmpPath: path, tmpCleanup: cleanupCallback });

        });

    });
};
