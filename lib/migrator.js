'use strict';

const Fs = require('fs');
const Path = require('path');
const Hoek = require('hoek');
const Items = require('items');
const Tmp = require('tmp');

exports.migrate = (knexGroups, defaultKnex, cb) => {

    const knexMigrations = new Map();

    for (let i = 0; i < knexGroups.length; ++i) {
        const knexGroup = knexGroups[i];
        const migrationsDir = knexGroup.migrationsDirectory;

        if (!migrationsDir) {
            continue;
        }

        const knex = knexGroup.knex || defaultKnex;

        Hoek.assert(knex, 'Cannot specify a migrations directory without an available knex instance.');

        if (!knexMigrations.has(knex)) {
            knexMigrations.set(knex, {});
        }

        const migrationsDirs = knexMigrations.get(knex);

        // Relativize and normalize, just how knex likes it
        const relMigrationsDir = Path.isAbsolute(migrationsDir) ?
                                    Path.relative(process.cwd(), migrationsDir) :
                                    Path.normalize(migrationsDir);

        migrationDirs[relMigrationsDir] = true;
    }

    // For each knex instance

    Items.serial(Array.from(knexMigrations), (migration, nextMigration) => {

        const knex = migration[0];
        const migrationsDirs = Object.keys(migration[1]);

        // Get a temp directory

        Tmp.file((err, tmpPath) => {

            if (err) {
                return nextMigration(err);
            }

            // Symlink files across all migration directories into that temp directory

            Items.parallel(migrationsDirs, (migrationsDir, nextDir) => {

                Fs.readdir(migrationsDir, (err, migrationsFiles) => {

                    if (err) {
                        return nextDir(err);
                    }

                    Items.parallel(migrationsFiles, (file, nextFile) => {

                        const name = Path.basename(file);

                        Fs.symlink(file, Path.join(tmpPath, name), nextFile);
                    }, nextDir);
                });
            }, (err) => {

                if (err) {
                    return nextMigration(err);
                }

                // Hand knex the temp directory filled with symlinks
                // to its migrations and ask it to migrate to latest

                return knex.migrate.latest({ directory: tmpPath }).asCallback(nextMigration);
            });
        });
    }, cb);
};
