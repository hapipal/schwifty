'use strict';

const Fs = require('fs');
const Path = require('path');
const Hoek = require('hoek');
const Items = require('items');
const Tmp = require('tmp');

const internals = {
    SUPPORTED_EXTENSIONS: ['.co', '.coffee', '.eg', '.iced', '.js', '.litcoffee', '.ls', '.ts'] // from knex
};

exports.migrate = (knexGroups, defaultKnex, rollback, cb) => {

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

    Items.serial(Array.from(knexMigrations), (migration, nextMigration) => {

        const knex = migration[0];
        const migrationsDirs = Object.keys(migration[1]);

        // Get a temp directory

        Tmp.dir({ unsafeCleanup: true }, (err, tmpPath, cleanupTmp) => {

            if (err) {
                return nextMigration(err);
            }

            // Set next migration callback to also perform tmp dir cleanup

            const origNextMigration = nextMigration;

            nextMigration = (err) => {

                cleanupTmp();
                origNextMigration(err);
            };

            // Symlink files across all migration directories into that temp directory

            Items.parallel(migrationsDirs, (migrationsDir, nextDir) => {

                Fs.readdir(migrationsDir, (err, migrationsFiles) => {

                    if (err) {
                        return nextDir(err);
                    }

                    Items.parallel(migrationsFiles, (name, nextFile) => {

                        // Don't bother symlinking non-migration files

                        if (internals.SUPPORTED_EXTENSIONS.indexOf(Path.extname(name)) === -1) {
                            return nextFile();
                        }

                        const file = Path.join(migrationsDir, name);
                        const link = Path.join(tmpPath, name);

                        Fs.symlink(file, link, nextFile);
                    }, nextDir);
                });
            }, (err) => {

                if (err) {
                    return nextMigration(err);
                }

                // Hand knex the temp directory filled with symlinks
                // to its migrations and ask it to migrate to latest

                const relMigrationsDir = Path.relative(process.cwd(), tmpPath);
                const latestOrRollback = rollback ? 'rollback' : 'latest';

                return knex.migrate[latestOrRollback]({ directory: relMigrationsDir }).asCallback(nextMigration);
            });
        });
    }, cb);
};
