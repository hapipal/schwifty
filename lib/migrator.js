'use strict';

const Fs = require('fs');
const Path = require('path');
const Tmp = require('tmp');
const Util = require('util');

const internals = {
    SUPPORTED_EXTENSIONS: ['.co', '.coffee', '.eg', '.iced', '.js', '.litcoffee', '.ls', '.ts'] // from knex
};

exports.migrate = async (migrations, rollback) => {

    for (const [knex, migrationsDirHash] of migrations) {
        await internals.executeMigration(knex, Object.keys(migrationsDirHash), rollback);
    }
};

internals.executeMigration = async (knex, migrationsDirs, rollback) => {

    // Promisifying callback-style functions at runtime allows us to monkey-patch these methods in our tests to simulate errors.  See /test/index.js, migrations tests usage of Fs.readdir and Tmp.dir.
    const { tmpPath, tmpCleanup } = await internals.tmpDir({ unsafeCleanup: true });

    try {

        await Promise.all(
            migrationsDirs.map(
                (migrationsDir) => internals.symlinkMigrationFiles(migrationsDir, tmpPath)
            )
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

internals.symlinkMigrationFiles = async (migrationsDir, tmpPath) => {

    const migrationFiles = await Util.promisify(Fs.readdir)(migrationsDir);

    await Promise.all(
        migrationFiles.map((file) => internals.createSymlink(file, migrationsDir, tmpPath))
    );
};

internals.createSymlink = async (migrationFile, migrationsDir, tmpPath) => {

    if (internals.SUPPORTED_EXTENSIONS.indexOf(Path.extname(migrationFile)) === -1) {
        return;
    }

    const file = Path.join(migrationsDir, migrationFile);
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
