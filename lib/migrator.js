'use strict';

const Fs = require('fs');
const Path = require('path');
const Hoek = require('hoek');
const Tmp = require('tmp');
const Promise = require('bluebird');

const internals = {
    SUPPORTED_EXTENSIONS: ['.co', '.coffee', '.eg', '.iced', '.js', '.litcoffee', '.ls', '.ts'] // from knex
};


// Bluebird converts the specified callback-style functions to Promise-style equivalents
// Their interfaces are the same, but their results are manipulated via Promises
// Note that Bluebird suffixes each promisified function with the word "Async",
// so to call our resultant utilities, e.g. tempDirAsync
internals.PROMISIFIED_UTILITIES = Promise.promisifyAll({
    tempDir: Tmp.dir,
    readDir: Fs.readdir,
    symlink: Fs.symlink
});

internals.executeMigration = async (migration, rollback) => {

    const knex = migration[0];
    const migrationsDirs = Object.keys(migration[1]);

    // TODO hmmmm you're not doing anything w/ the success result here.... FUCK
    // TODO unfuck this variable name
    const tmpResults = internals.PROMISIFIED_UTILITIES.tempDirAsync({ unsafeCleanup: true });
    console.log(tmpResults, 'BOLOGNESE');
    // iT'S PROBABLY AN ARRAY (OR ARRAY-LIKE OBJECT E.G. ARGUMENTS)

    const directoriesToRead = [];
    const symlinkConfig = {
        tmpPath: tmpResults[0]
    };

    for (const migrationsDir of migrationsDirs) {
        symlinkConfig.migrationsDir = migrationsDir;
        directoriesToRead.push(internals.readMigrationDir(migrationsDir, symlinkConfig));
    }

    try {
        await Promise.all(directoriesToRead);
    }
    catch (err) {

        // Even if our symlinking fails, we need to manually cleanup our temporary directory because
        // the unsafeCleanup: true option we pass to tempDirAsync (Tmp.dir) causes the tool to not delete the temp directory
        // if it has entries, which it will if we fail partway through
        tmpResults.cleanup();
    }

    // TODO Review / fix tmpAssets.tmpPath
    const relMigrationsDir = Path.relative(process.cwd(), tmpResults.tmpPath);
    const latestOrRollback = rollback ? 'rollback' : 'latest';

    await knex.migrate[latestOrRollback]({ directory: relMigrationsDir });

    // TODO does this work? What happens when a callback takes 2 non-error parameters?
    tmpResults.cleanup();
};

internals.readMigrationDir = async (migrationDir, symlinkConfig) => {

    const migrationFiles = await internals.PROMISIFIED_UTILITIES.readDirAsync(migrationDir);
    const migrationSymlinks = [];

    for (const file in migrationFiles) {
        migrationSymlinks.push(internals.symlinkMigrationFile(file, symlinkConfig));
    }

    await Promise.all(migrationSymlinks);
};

internals.symlinkMigrationFile = async (migrationFile, symlinkConfig) => {

    if (internals.SUPPORTED_EXTENSIONS.indexOf(Path.extname(migrationFile)) === -1) {
        return;
    }

    const file = Path.join(symlinkConfig.migrationsDir, migrationFile);
    const link = Path.join(symlinkConfig.tmpPath, migrationFile);

    await internals.PROMISIFIED_UTILITIES.symlinkAsync(file, link);
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
    // TODO No longer need to use Array.from because for ... of accesses only iterables in an iterable object i.e. values of Map's keys ... is that right?
    for (const migration of knexMigrations) {
        await internals.executeMigration(migration, rollback);
    }

};
