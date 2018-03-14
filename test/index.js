'use strict';

// Load modules

const Fs = require('fs');
const Path = require('path');
const Tmp = require('tmp');
const Lab = require('lab');
const Code = require('code');
const Hapi = require('hapi');
const Joi = require('joi');
const Hoek = require('hoek');
const Objection = require('objection');
const Knex = require('knex');
const TestModels = require('./models');
const Schwifty = require('..');

// Test shortcuts

const lab = exports.lab = Lab.script();
const expect = Code.expect;
const describe = lab.describe;
const before = lab.before;
const it = lab.it;

describe('Schwifty', () => {

    const getOptions = (extras = {}) => {

        const options = {
            knex: {
                client: 'sqlite3',
                useNullAsDefault: true,
                connection: {
                    filename: ':memory:'
                }
            }
        };

        return Hoek.applyToDefaults(options, extras);
    };

    const makeKnex = () => {

        return Knex({
            client: 'sqlite3',
            useNullAsDefault: true,
            connection: {
                filename: ':memory:'
            },
            migrations: {
                tableName: 'TestMigrations'
            }
        });
    };

    const basicKnexConfig = {
        client: 'sqlite3',
        useNullAsDefault: true
    };

    const getServer = async (options) => {

        const server = Hapi.server();

        await server.register({
            plugin: Schwifty,
            options
        });

        return server;
    };

    const modelsFile = './models/as-file.js';

    const state = (realm) => {

        return realm.plugins.schwifty;
    };

    const getRootRealm = (server) => {

        let realm = server.realm;

        while (realm.parent) {
            realm = realm.parent;
        }

        return realm;
    };

    before(() => {

        require('sqlite3'); // Just warm-up sqlite, so that the tests have consistent timing
    });

    it('connects models to knex instance during onPreStart.', async () => {

        const config = getOptions({
            models: [
                TestModels.Dog,
                TestModels.Person
            ]
        });

        const server = await getServer(config);

        expect(server.models().Dog.knex()).to.not.exist();
        expect(server.models().Person.knex()).to.not.exist();

        await server.initialize();

        expect(server.models().Dog.knex()).to.exist();
        expect(server.models().Person.knex()).to.exist();
    });

    it('tears-down connections onPostStop.', async () => {

        const server = await getServer(getOptions());
        let toredown = 0;

        const origDestroy = server.knex().destroy;
        server.knex().destroy = () => {

            ++toredown;
            return origDestroy();
        };

        await server.initialize();
        await server.stop();

        expect(toredown).to.equal(1);
    });

    it('tears-down multiple connections onPostStop.', async () => {

        const server = await getServer(getOptions());

        let toredown = 0;

        const plugin1 = {
            name: 'plugin-one',
            register: (srv, opts) => {

                // Creates plugin-specific knex instance using the base connection configuration specified in getOptions
                srv.schwifty(getOptions({
                    models: [
                        TestModels.Dog,
                        TestModels.Person
                    ]
                }));

                expect(srv.knex()).to.not.shallow.equal(server.knex());

                const origDestroy = server.knex().destroy;
                server.knex().destroy = () => {

                    ++toredown;
                    return origDestroy();
                };
            }
        };

        const plugin2 = {
            name: 'plugin-two',
            register: (srv, opts) => {

                srv.schwifty([TestModels.Zombie]);

                // Plugin 2 will use the root server's (referenced by server variable) knex connection
                expect(srv.knex()).to.shallow.equal(server.knex());

                const origDestroy = server.knex().destroy;
                server.knex().destroy = () => {

                    ++toredown;
                    return origDestroy();
                };
            }
        };

        await server.register([plugin1, plugin2]);
        await server.initialize();
        await server.stop();

        expect(toredown).to.equal(2);
    });

    it('does not tear-down connections onPostStop with option `teardownOnStop` false.', async () => {

        const options = getOptions({ teardownOnStop: false });
        const server = await getServer(options);
        let toredown = 0;

        const origDestroy = server.knex().destroy;
        server.knex().destroy = () => {

            ++toredown;
            return origDestroy();
        };

        server.ext('onPreStop', () => {

            expect(server.knex()).to.exist();
        });

        await server.initialize();
        await server.stop();

        expect(toredown).to.equal(0);
    });

    it('can be registered multiple times.', async () => {

        const server = await getServer(getOptions({
            models: [
                TestModels.Dog,
                TestModels.Person
            ]
        }));

        expect(server.registrations.schwifty).to.exist();

        await server.register({
            plugin: Schwifty,
            options: { models: [TestModels.Movie, TestModels.Zombie] }
        });

        expect(Object.keys(server.models())).to.only.contain([
            'Dog',
            'Person',
            'Movie',
            'Zombie'
        ]);
    });

    describe('hpal command', () => {

        it('correctly registers', async () => {

            console._log = console.log;
            const logOutput = [];

            console.log = (...args) => {

                logOutput.push(...args);
            };

            const migrationsDir = './test/migrations/generated';

            // Remove migration file from any previous test run
            Fs.readdirSync(migrationsDir)
                .forEach((migrationFile) => {

                    const filePath = Path.join(migrationsDir, migrationFile);

                    if (filePath.includes('gitkeep')) {
                        return;
                    }

                    Fs.unlinkSync(filePath);
                });

            const server = await getServer(getOptions({
                migrationsDir,
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }));

            expect(server.plugins.schwifty.commands && server.plugins.schwifty.commands.migrations).to.exist();

            await server.initialize();
            await server.plugins.schwifty.commands.migrations(server, []);
            await server.stop();

            expect(logOutput[0].includes('//////////////')).to.equal(true);
            expect(logOutput[1].includes('Success!')).to.equal(true);
            expect(logOutput[2].includes('Generated new migration file:')).to.equal(true);

            // Let's ensure the migration looks correct
            const expectedMigrationContents = Fs.readFileSync(Path.join(migrationsDir, '../expected-generated-migration.js')).toString('utf8');

            // Grab the latest migration
            const migrationPathFiles = Fs.readdirSync(migrationsDir);
            const latestMigration = migrationPathFiles[migrationPathFiles.length - 1];
            const latestMigrationPath = Path.resolve(migrationsDir, latestMigration);
            const latestMigrationContents = Fs.readFileSync(latestMigrationPath).toString('utf8');

            expect(latestMigrationContents).to.equal(expectedMigrationContents);

            console.log = console._log;
        });

        it('by default uses migrationsDir from Schwifty options but accepts a different one in args', async () => {

            console._log = console.log;
            const logOutput = [];

            console.log = (...args) => {

                logOutput.push(...args);
            };

            const migrationsDir = './test/migrations/generated';
            const altMigrationsDir = './test/migrations/generated2';

            // Remove migration file from any previous test run
            Fs.readdirSync(altMigrationsDir)
                .forEach((migrationFile) => {

                    const filePath = Path.join(altMigrationsDir, migrationFile);

                    if (filePath.includes('gitkeep')) {
                        return;
                    }

                    Fs.unlinkSync(filePath);
                });

            const server = await getServer(getOptions({
                migrationsDir,
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }));

            expect(server.plugins.schwifty.commands && server.plugins.schwifty.commands.migrations).to.exist();

            await server.initialize();
            await server.plugins.schwifty.commands.migrations(server, ['alter', 'alt-migration', altMigrationsDir]);
            await server.stop();

            expect(logOutput[0].includes('//////////////')).to.equal(true);
            expect(logOutput[1].includes('Success!')).to.equal(true);
            expect(logOutput[2].includes('Generated new migration file:')).to.equal(true);

            // Let's ensure the migration looks correct
            const expectedMigrationContents = Fs.readFileSync(Path.join(altMigrationsDir, '../expected-generated-migration.js')).toString('utf8');

            // Grab the latest migration
            const migrationPathFiles = Fs.readdirSync(altMigrationsDir);
            const latestMigration = migrationPathFiles[migrationPathFiles.length - 1];
            const latestMigrationPath = Path.resolve(altMigrationsDir, latestMigration);
            const latestMigrationContents = Fs.readFileSync(latestMigrationPath).toString('utf8');

            expect(latestMigrationContents).to.equal(expectedMigrationContents);

            console.log = console._log;
        });
    });

    describe('plugin registration', () => {

        it('takes `models` option as a relative path.', async () => {

            const options = getOptions({ models: Path.normalize('./test/' + modelsFile) });
            const server = await getServer(options);
            const models = server.models();

            expect(models.Dog).to.exist();
            expect(models.Person).to.exist();
        });

        it('takes `models` option as an absolute path.', async () => {

            const options = getOptions({ models: Path.normalize(__dirname + '/' + modelsFile) });
            const server = await getServer(options);
            const models = server.models();

            expect(models.Dog).to.exist();
            expect(models.Person).to.exist();
        });

        it('takes `models` option respecting server.path().', async () => {

            const server = Hapi.server();
            server.path(__dirname);

            await server.register({
                plugin: Schwifty,
                options: getOptions({ models: modelsFile })
            });

            const models = server.models();

            expect(models.Dog).to.exist();
            expect(models.Person).to.exist();
        });

        it('takes `models` option as an array of objects.', async () => {

            const options = getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            });

            const server = await getServer(options);
            const models = server.models();

            expect(models.Dog).to.exist();
            expect(models.Person).to.exist();
        });

        it('throws if the `models` option is not an array or string.', async () => {

            const options = getOptions({ models: {} });

            // We check the message against a regex because it also contains info on the server's knex connection and models, which are impractical / impossible to match exactly via string
            await expect(getServer(options)).to.reject(/^Bad plugin options passed to schwifty\./);
        });

        it('throws when `teardownOnStop` is specified more than once.', async () => {

            const options = getOptions({ teardownOnStop: false });
            const server = await getServer(options);
            const plugin = {
                name: 'my-plugin',
                register: async (srv, opts) => {

                    await srv.register({ options, plugin: Schwifty });
                }
            };

            await expect(server.register(plugin)).to.reject('Schwifty\'s teardownOnStop option can only be specified once.');
        });

        it('throws when `migrateOnStart` is specified more than once.', async () => {

            const server = await getServer({ migrateOnStart: false });
            const plugin = {
                name: 'my-plugin',
                register: async (srv, opts) => {

                    await srv.register({ plugin: Schwifty, options: { migrateOnStart: false } });
                }
            };

            await expect(server.register(plugin)).to.reject('Schwifty\'s migrateOnStart option can only be specified once.');
        });

        it('throws when multiple knex instances passed to same server.', async () => {

            const server = await getServer({ knex: Knex(basicKnexConfig) });

            await expect(server.register({
                plugin: Schwifty,
                options: { knex: Knex(basicKnexConfig) }
            })).to.reject('A knex instance/config may be specified only once per server or plugin.');
        });
    });

    describe('server.schwifty() decoration', () => {

        it('aggregates models across plugins.', async () => {

            const options = getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            });

            const server = await getServer(options);

            const plugin1 = {
                name: 'plugin-one',
                register: (srv, opts) => {

                    srv.schwifty({
                        models: [TestModels.Movie]
                    });
                }
            };

            const plugin2 = {
                name: 'plugin-two',
                register: (srv, opts) => {

                    srv.schwifty({
                        models: [TestModels.Zombie]
                    });
                }
            };

            await server.register([plugin1, plugin2]);
            await server.initialize();

            // Grab all models across plugins by passing true here:
            const models = server.models(true);

            expect(models.Dog.tableName).to.equal('Dog');
            expect(models.Person.tableName).to.equal('Person');
            expect(models.Zombie.tableName).to.equal('Zombie');
            expect(models.Movie.tableName).to.equal('Movie');
        });

        it('aggregates model definitions within a plugin.', async () => {

            const server = await getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }));

            const rootState = state(getRootRealm(server));
            expect(Object.keys(rootState.models)).to.equal(['Dog', 'Person']);

            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.schwifty({
                        models: [TestModels.Movie]
                    });

                    srv.schwifty({
                        models: [TestModels.Zombie]
                    });

                    srv.app.myState = state(srv.realm);
                }
            };

            await server.register(plugin);
            await server.initialize();

            expect(Object.keys(server.app.myState.models)).to.equal(['Movie', 'Zombie']);
            expect(Object.keys(rootState.models)).to.only.contain([
                'Dog',
                'Person',
                'Movie',
                'Zombie'
            ]);
        });

        it('accepts a single model definition.', async () => {

            const server = await getServer(getOptions());

            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.schwifty(TestModels.Zombie);
                }
            };

            await server.register(plugin);

            expect(state(server.realm).models.Zombie).to.exist();
        });

        it('accepts `knex` as a knex instance.', async () => {

            const options = getOptions();
            delete options.knex;

            const server = await getServer(options);
            const knex = Knex(basicKnexConfig);

            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.schwifty({ knex });

                    expect(srv.knex()).to.shallow.equal(knex);
                }
            };

            await server.register(plugin);
        });

        it('throws on invalid config.', async () => {

            const server = await getServer(getOptions());

            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    expect(() => {

                        srv.schwifty({ invalidProp: 'bad' });
                    }).to.throw(/\"invalidProp\" is not allowed/);
                }
            };

            await server.register(plugin);
        });

        it('throws on model name collision.', async () => {

            const server = await getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }));

            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.schwifty(TestModels.Dog);
                }
            };

            await expect(server.register(plugin)).to.reject('Model "Dog" has already been registered.');
        });

        it('throws when multiple knex instances passed to same plugin.', async () => {

            const server = await getServer({});

            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.schwifty({ knex: Knex(basicKnexConfig) });

                    expect(() => {

                        srv.schwifty({ knex: Knex(basicKnexConfig) });
                    }).to.throw('A knex instance/config may be specified only once per server or plugin.');
                }
            };

            await server.register(plugin);
        });
    });

    describe('request.knex(), server.knex(), and h.knex() decorations', () => {

        it('returns root server\'s knex instance by default.', async () => {

            const knex = makeKnex();
            const server = await getServer({ knex });

            const plugin = {
                name: 'plugin',
                register: (srv, opts) => {

                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request) => {

                            expect(request.knex()).to.shallow.equal(knex);
                            return { ok: true };
                        }
                    });

                    srv.ext('onRequest', (request, h) => {

                        expect(h.knex()).to.shallow.equal(knex);
                        return h.continue;
                    });

                    expect(srv.knex()).to.shallow.equal(knex);
                }
            };

            await server.register(plugin);

            // Root server's knex
            expect(server.knex()).to.shallow.equal(knex);

            const res = await server.inject('/plugin');
            expect(res.result).to.equal({ ok: true });
        });

        it('returns plugin\'s knex instance over root server\'s.', async () => {

            const knex1 = makeKnex();
            const knex2 = makeKnex();
            const server = await getServer({ knex: knex1 });

            const plugin = {
                name: 'plugin',
                register: (srv, opts) => {

                    srv.schwifty({ knex: knex2 });

                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request) => {

                            expect(request.knex()).to.shallow.equal(knex2);
                            return { ok: true };
                        }
                    });

                    srv.ext('onRequest', (request, h) => {

                        expect(h.knex()).to.shallow.equal(knex2);
                        return h.continue;
                    });

                    expect(srv.knex()).to.shallow.equal(knex2);
                }
            };

            await server.register(plugin);

            // Root server's knex
            expect(server.knex()).to.shallow.equal(knex1);

            const res = await server.inject('/plugin');
            expect(res.result).to.equal({ ok: true });
        });

        it('returns null when there are no plugin or root knex instances.', async () => {

            const server = await getServer({});

            const plugin = {
                name: 'plugin',
                register: (srv, opts) => {

                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request) => {

                            expect(request.knex()).to.equal(null);
                            return { ok: true };
                        }
                    });

                    srv.ext('onRequest', (request, h) => {

                        expect(h.knex()).to.equal(null);
                        return h.continue;
                    });

                    expect(srv.knex()).to.equal(null);
                }
            };

            await server.register(plugin);

            // Root server's non-knex
            expect(server.knex()).to.equal(null);

            const res = await server.inject('/plugin');
            expect(res.result).to.equal({ ok: true });
        });
    });

    describe('server initialization', () => {

        it('binds knex instances to models.', async () => {

            const knex = makeKnex();
            const server = await getServer({ knex, models: [TestModels.Person] });

            expect(server.models().Person.knex()).to.not.exist();

            await server.initialize();

            expect(server.models().Person.knex()).to.shallow.equal(knex);
        });

        it('binds root knex instance to plugins\' models by default.', async () => {

            const knex = makeKnex();
            const server = await getServer({ knex });

            const plugin = {
                name: 'plugin',
                register: (srv, opts) => {

                    srv.schwifty(TestModels.Person);
                }
            };

            await server.register(plugin);
            expect(server.models(true).Person.knex()).to.not.exist();

            await server.initialize();
            expect(server.models(true).Person.knex()).to.shallow.equal(knex);
        });

        it('binds plugins\' knex instance to plugins\' models over roots\'.', async () => {

            const knex1 = makeKnex();
            const knex2 = makeKnex();
            const server = await getServer({ knex: knex1 });

            const plugin = {
                name: 'plugin',
                register: (srv, opts) => {

                    srv.schwifty({ knex: knex2, models: [TestModels.Person] });
                }
            };

            await server.register(plugin);
            expect(server.models(true).Person.knex()).to.not.exist();

            await server.initialize();
            expect(server.models(true).Person.knex()).to.shallow.equal(knex2);
        });

        it('does not bind knex instance to models when there are no plugin or root knex instances.', async () => {

            const server = await getServer({});

            const plugin = {
                name: 'plugin',
                register: (srv, opts) => {

                    srv.schwifty(TestModels.Person);
                }
            };

            await server.register(plugin);
            expect(server.models(true).Person.knex()).to.not.exist();

            await server.initialize();
            expect(server.models(true).Person.knex()).to.not.exist();
        });

        it('does not bind knex instance when model already has a knex instance.', async () => {

            const knex1 = makeKnex();
            const knex2 = makeKnex();

            const Person = class Person extends TestModels.Person {};
            Person.knex(knex2);

            const server = await getServer({ knex: knex1, models: [Person] });

            expect(server.models().Person).to.shallow.equal(Person);
            expect(server.models().Person.knex()).to.shallow.equal(knex2);

            await server.initialize();

            expect(server.models().Person).to.shallow.equal(Person);
            expect(server.models().Person.knex()).to.shallow.equal(knex2);
        });

        describe('bails when a knex instance is not pingable', () => {

            const failKnexWith = (knex, error) => {

                knex.queryBuilder = () => ({
                    select: () => {

                        throw error;
                    }
                });

                return knex;
            };

            it('and lists associated models in error.', async () => {

                const knex = failKnexWith(makeKnex(), new Error());
                const server = await getServer({ knex, models: [TestModels.Dog] });

                const plugin = {
                    name: 'plugin',
                    register: (srv, opts) => {

                        srv.schwifty(TestModels.Person);
                    }
                };

                await server.register(plugin);
                await expect(server.initialize()).to.reject(/^Could not connect to database using schwifty knex instance for models: "Dog", "Person"\./);
            });

            it('and doesn\'t list associated models in error when there are none.', async () => {

                const knex = failKnexWith(makeKnex(), new Error());
                const server = await getServer({ knex });

                await expect(server.initialize()).to.reject(/^Could not connect to database using schwifty knex instance\./);
            });

            it('and augments the original error\'s message.', async () => {

                const error = new Error('Also this other thing went wrong.');
                const knex = failKnexWith(makeKnex(), error);
                const server = await getServer({ knex });

                const thrown = await expect(server.initialize()).to.reject();
                expect(thrown).to.shallow.equal(error);
                expect(thrown.message).to.equal('Could not connect to database using schwifty knex instance.: Also this other thing went wrong.');
            });

            it('and adds a message to the original error if it did not already have one.', async () => {

                const error = new Error();
                const knex = failKnexWith(makeKnex(), error);
                const server = await getServer({ knex });

                const thrown = await expect(server.initialize()).to.reject();
                expect(thrown).to.shallow.equal(error);
                expect(thrown.message).to.equal('Could not connect to database using schwifty knex instance.');
            });

            it('and only requires one not be pingable to fail.', async () => {

                const server = await getServer({ knex: makeKnex() });

                const error = new Error();
                const knex = failKnexWith(makeKnex(), error);
                const plugin = {
                    name: 'plugin',
                    register: (srv, opts) => {

                        srv.schwifty({ knex });
                    }
                };

                await server.register(plugin);

                const thrown = await expect(server.initialize()).to.reject();
                expect(thrown).to.shallow.equal(error);
            });
        });
    });

    describe('migrations', () => {

        it('does not run by default.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: './test/migrations/basic'
            }));

            const versionPre = await server.knex().migrate.currentVersion();
            expect(versionPre).to.equal('none');

            await server.initialize();

            const versionPost = await server.knex().migrate.currentVersion();
            expect(versionPost).to.equal('none');
        });

        it('does not run when `migrateOnStart` plugin/server option is `false`.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: false
            }));

            const versionPre = await server.knex().migrate.currentVersion();
            expect(versionPre).to.equal('none');

            await server.initialize();

            const versionPost = await server.knex().migrate.currentVersion();
            expect(versionPost).to.equal('none');
        });

        it('migrates to latest when `migrateOnStart` plugin/server option is `true`.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }));

            const versionPre = await server.knex().migrate.currentVersion();
            expect(versionPre).to.equal('none');

            await server.initialize();

            const versionPost = await server.knex().migrate.currentVersion();
            expect(versionPost).to.equal('basic.js');
        });

        it('migrates to latest when `migrateOnStart` plugin/server option is `\'latest\'`.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: 'latest'
            }));

            const versionPre = await server.knex().migrate.currentVersion();
            expect(versionPre).to.equal('none');

            await server.initialize();

            const versionPost = await server.knex().migrate.currentVersion();
            expect(versionPost).to.equal('basic.js');
        });

        it('rollsback when `migrateOnStart` plugin/server option is `\'rollback\'`.', async () => {

            const server1 = await getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }));

            await server1.initialize();
            const versionPre = await server1.knex().migrate.currentVersion();
            expect(versionPre).to.equal('basic.js');

            const server2 = await getServer({
                knex: server1.knex(),
                migrationsDir: './test/migrations/basic',
                migrateOnStart: 'rollback'
            });

            expect(server1.knex()).to.shallow.equal(server2.knex());

            await server2.initialize();
            const versionPost = await server2.knex().migrate.currentVersion();
            expect(versionPost).to.equal('none');
        });

        it('accepts absolute `migrationsDir`s.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: Path.join(process.cwd(), 'test/migrations/basic'),
                migrateOnStart: true
            }));

            await server.initialize();

            const version = await server.knex().migrate.currentVersion();
            expect(version).to.equal('basic.js');
        });

        it('respects server.path() when setting `migrationsDir`.', async () => {

            const server = await getServer(getOptions({
                migrateOnStart: true
            }));

            server.path(`${__dirname}/migrations`);
            server.schwifty({ migrationsDir: 'basic' });

            const versionPre = await server.knex().migrate.currentVersion();
            expect(versionPre).to.equal('none');

            await server.initialize();

            const versionPost = await server.knex().migrate.currentVersion();
            expect(versionPost).to.equal('basic.js');
        });

        it('coalesces migrations in different directories across plugins sharing knex instances.', async () => {

            // Generates an object callable by server.register
            const makePlugin = (id, knex, migrationsDir) => ({
                name: `plugin-${id}`,
                register: (server, options) => {

                    server.schwifty({ knex, migrationsDir });
                }
            });

            const knex1 = makeKnex();
            const knex2 = makeKnex();

            // Our root server uses the knex1 knex instance as its default
            // (fallback if no plugin-specific instance)
            const server = await getServer({
                knex: knex1,
                migrateOnStart: true
            });

            // plugin3 will default to using knex1 as the plugin's knex instance,
            // so we'll expect this directory's migration files to be listed for the knex1 instance.

            const plugin1 = makePlugin(1, knex1, './test/migrations/basic');
            const plugin2 = makePlugin(2, knex2, './test/migrations/basic');
            const plugin3 = makePlugin(3, undefined, './test/migrations/extras-one');
            const plugin4 = makePlugin(4, knex2, './test/migrations/extras-two');
            const plugin5 = makePlugin(5, knex1);

            await server.register([
                plugin1,
                plugin2,
                plugin3,
                plugin4,
                plugin5
            ]);

            await server.initialize();

            const migrations1 = await knex1('TestMigrations').columns('name').orderBy('name', 'asc');
            const migrations2 = await knex2('TestMigrations').columns('name').orderBy('name', 'asc');

            const getName = (x) => x.name;

            expect(migrations1.map(getName)).to.equal(['basic.js', 'extras-one-1st.js', 'extras-one-2nd.js']);
            expect(migrations2.map(getName)).to.equal(['basic.js', 'extras-two-1st.js', 'extras-two-2nd.js']);
        });

        it('ignores non-migration files.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: './test/migrations/non-migration',
                migrateOnStart: true
            }));

            await server.initialize();

            const version = await server.knex().migrate.currentVersion();

            // If 2nd-bad had run, that would be the current version due to sort order
            expect(version).to.equal('1st-good.js');
        });

        it('bails when failing to make a temp migrations directory.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }));

            // Monkey-patches Tmp.dir to simulate an error in that method
            const origTmpDir = Tmp.dir;
            Tmp.dir = (opts, cb) => {

                // Reverts Tmp.dir back to its original definition, so subsequent tests use the normal function
                Tmp.dir = origTmpDir;
                cb(new Error('Generating temp dir failed.'));
            };

            // We expect server initialization to fail with the simulated Tmp error message
            await expect(server.initialize()).to.reject('Generating temp dir failed.');

            const version = await server.knex().migrate.currentVersion();
            expect(version).to.equal('none');
        });

        it('bails when failing to read a migrations directory.', async () => {

            const server = await getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }));

            // Monkey-patches Fs.readdir to simulate an error in that method
            const origReaddir = Fs.readdir;
            Fs.readdir = (opts, cb) => {

                // Reverts Fs.readdir back to its original definition, so subsequent tests use the normal function
                Fs.readdir = origReaddir;
                cb(new Error('Reading migrations dir failed.'));
            };

            await expect(server.initialize()).to.reject('Reading migrations dir failed.');

            const version = await server.knex().migrate.currentVersion();
            expect(version).to.equal('none');
        });
    });

    describe('request.models(), server.models(), and h.models() decorations', () => {

        it('return empty object before server initialization.', async () => {

            const server = await getServer(getOptions());

            server.route({
                path: '/',
                method: 'get',
                handler: (request) => {

                    expect(request.models()).to.equal({});
                    expect(request.models(true)).to.equal({});
                    return { ok: true };
                }
            });

            expect(server.models()).to.equal({});
            expect(server.models(true)).to.equal({});

            const response = await server.inject('/');
            expect(response.result).to.equal({ ok: true });
        });

        it('return empty object if no models have been added.', async () => {

            const server = await getServer(getOptions());

            server.route({
                path: '/root',
                method: 'get',
                handler: (request) => {

                    expect(request.models()).to.equal({});
                    expect(request.models(true)).to.equal({});
                    return { ok: 'root' };
                }
            });

            server.ext('onRequest', (request, h) => {

                expect(h.models()).to.equal({});
                expect(h.models(true)).to.equal({});

                return h.continue;
            });

            expect(server.models()).to.equal({});
            expect(server.models(true)).to.equal({});

            // Plugin here to show that models() defaults to {} (schwifty isn't called)
            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request) => {

                            const models = request.models();
                            expect(models).to.equal({});
                            return { ok: 'plugin' };
                        }
                    });

                    srv.ext('onRequest', (request, h) => {

                        expect(h.models()).to.equal({});
                        expect(h.models(true)).to.equal({});

                        return h.continue;
                    });
                }
            };

            await server.register(plugin);
            await server.initialize();

            const res1 = await server.inject('/root');
            expect(res1.result).to.equal({ ok: 'root' });

            const res2 = await server.inject('/plugin');
            expect(res2.result).to.equal({ ok: 'plugin' });
        });

        it('solely return models registered in route\'s realm by default.', async () => {

            const server = await getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }));

            server.route({
                path: '/root',
                method: 'get',
                handler: (request) => {

                    const models = request.models();
                    expect(models).to.have.length(3);
                    expect(models.Dog.tableName).to.equal('Dog');
                    expect(models.Person.tableName).to.equal('Person');
                    expect(models.Movie.tableName).to.equal('Movie');
                    return { ok: 'root' };
                }
            });

            server.ext('onPreStart', () => {

                const models = server.models();
                expect(models).to.have.length(3);
                expect(models.Dog.tableName).to.equal('Dog');
                expect(models.Person.tableName).to.equal('Person');
                expect(models.Movie.tableName).to.equal('Movie');
            });

            server.ext('onRequest', (request, h) => {

                const models = h.models();
                expect(models).to.have.length(3);
                expect(models.Dog.tableName).to.equal('Dog');
                expect(models.Person.tableName).to.equal('Person');
                expect(models.Movie.tableName).to.equal('Movie');

                return h.continue;
            });

            const plugin = {
                name: 'my-plugin',
                register: (srv) => {

                    srv.schwifty(TestModels.Movie);
                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request) => {

                            const models = request.models();
                            expect(models).to.have.length(1);
                            expect(models.Movie.tableName).to.equal('Movie');
                            return { ok: 'plugin' };
                        }
                    });
                    srv.ext('onPreStart', () => {

                        const models = srv.models();
                        expect(models).to.have.length(1);
                        expect(models.Movie.tableName).to.equal('Movie');
                    });
                    srv.ext('onRequest', (request, h) => {

                        const models = h.models();
                        expect(models).to.have.length(1);
                        expect(models.Movie.tableName).to.equal('Movie');

                        return h.continue;
                    });
                }
            };

            await server.register(plugin);
            await server.initialize();

            const res1 = await server.inject('/root');
            expect(res1.result).to.equal({ ok: 'root' });

            const res2 = await server.inject('/plugin');
            expect(res2.result).to.equal({ ok: 'plugin' });
        });

        it('return empty object if no models defined in route\'s realm.', async () => {

            const server = await getServer(getOptions());
            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.route({
                        path: '/',
                        method: 'get',
                        handler: (request) => {

                            const models = request.models();
                            expect(models).to.be.an.object();
                            expect(Object.keys(models)).to.have.length(0);
                            return { ok: true };
                        }
                    });
                    srv.ext('onPreStart', () => {

                        const models = srv.models();
                        expect(models).to.be.an.object();
                        expect(Object.keys(models)).to.have.length(0);
                    });
                    srv.ext('onRequest', (request, h) => {

                        const models = h.models();
                        expect(models).to.be.an.object();
                        expect(Object.keys(models)).to.have.length(0);

                        return h.continue;
                    });
                }
            };

            await server.register(plugin);
            await server.initialize();

            const response = await server.inject('/');
            expect(response.result).to.equal({ ok: true });
        });

        it('return models across all realms when passed true.', async () => {

            const server = await getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }));

            server.route({
                path: '/root',
                method: 'get',
                handler: (request) => {

                    const models = request.models(true);
                    expect(models).to.have.length(3);
                    expect(models.Dog.tableName).to.equal('Dog');
                    expect(models.Person.tableName).to.equal('Person');
                    expect(models.Zombie.tableName).to.equal('Zombie');
                    return { ok: 'root' };
                }
            });
            server.ext('onPreStart', () => {

                const models = server.models(true);
                expect(models).to.have.length(3);
                expect(models.Dog.tableName).to.equal('Dog');
                expect(models.Person.tableName).to.equal('Person');
                expect(models.Zombie.tableName).to.equal('Zombie');
            });
            server.ext('onRequest', (request, h) => {

                const models = h.models(true);
                expect(models).to.have.length(3);
                expect(models.Dog.tableName).to.equal('Dog');
                expect(models.Person.tableName).to.equal('Person');
                expect(models.Zombie.tableName).to.equal('Zombie');

                return h.continue;
            });

            const plugin = {
                name: 'my-plugin',
                register: (srv, opts) => {

                    srv.schwifty([TestModels.Zombie]);
                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request) => {

                            const models = request.models(true);
                            expect(models).to.have.length(3);
                            expect(models.Dog.tableName).to.equal('Dog');
                            expect(models.Person.tableName).to.equal('Person');
                            expect(models.Zombie.tableName).to.equal('Zombie');
                            return { ok: 'plugin' };
                        }
                    });
                    srv.ext('onPreStart', () => {

                        const models = srv.models(true);
                        expect(models).to.have.length(3);
                        expect(models.Dog.tableName).to.equal('Dog');
                        expect(models.Person.tableName).to.equal('Person');
                        expect(models.Zombie.tableName).to.equal('Zombie');
                    });
                    srv.ext('onRequest', (request, h) => {

                        const models = h.models(true);
                        expect(models).to.have.length(3);
                        expect(models.Dog.tableName).to.equal('Dog');
                        expect(models.Person.tableName).to.equal('Person');
                        expect(models.Zombie.tableName).to.equal('Zombie');

                        return h.continue;
                    });
                }
            };

            await server.register(plugin);
            await server.initialize();

            const res1 = await server.inject('/root');
            expect(res1.result).to.equal({ ok: 'root' });

            const res2 = await server.inject('/plugin');
            expect(res2.result).to.equal({ ok: 'plugin' });
        });
    });

    describe('Model', () => {

        describe('$validate()', () => {

            it('validates correct schema input.', () => {

                const chompy = new TestModels.Zombie();

                const validateRes = chompy.$validate({
                    firstName: 'Chompy',
                    lastName: 'Chomperson'
                });

                expect(validateRes).to.equal({
                    favoriteFood: 'Tasty brains',
                    firstName: 'Chompy',
                    lastName: 'Chomperson'
                });
            });

            it('defaults to validate itself if no json passed.', () => {

                const chompy = new TestModels.Zombie();
                chompy.firstName = 'Chompy';

                const validateRes = chompy.$validate();

                expect(validateRes).to.equal({
                    firstName: 'Chompy',
                    favoriteFood: 'Tasty brains'
                });
            });

            it('throws Objection.ValidationError if required schema item not provided to $validate().', () => {

                const chompy = new TestModels.Zombie();

                expect(() => {

                    chompy.$validate({
                        lastName: 'Chomperson'
                    });
                }).to.throw(Objection.ValidationError, /"firstName" is required/);
            });

            it('throws Objection.ValidationError if bad types are passed.', () => {

                const chompy = new TestModels.Zombie();

                expect(() => {

                    chompy.$validate({
                        firstName: 'Chompy',
                        lastName: 1234
                    });
                }).to.throw(Objection.ValidationError, /"lastName" must be a string/);
            });

            it('throws Objection.ValidationError with multiple errors per key.', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object({
                            persnicketyField: Joi.string().max(1).min(10)
                        }).options({
                            abortEarly: false
                        });
                    }
                };

                const instance = new Model();
                const persnickety = { persnicketyField: 'xxxxx' }; // Length of 5, bigger than max and less than min

                let error;

                try {
                    instance.$validate(persnickety);
                }
                catch (e) {
                    error = e;
                }

                expect(error).to.be.an.instanceof(Objection.ValidationError);

                expect(error.data).to.equal({
                    persnicketyField: [
                        {
                            message: '"persnicketyField" length must be less than or equal to 1 characters long',
                            keyword: 'string.max',
                            params: {
                                limit: 1,
                                value: 'xxxxx',
                                encoding: undefined,
                                key: 'persnicketyField',
                                label: 'persnicketyField'
                            }
                        },
                        {
                            message: '"persnicketyField" length must be at least 10 characters long',
                            keyword: 'string.min',
                            params: {
                                limit: 10,
                                value: 'xxxxx',
                                encoding: undefined,
                                key: 'persnicketyField',
                                label: 'persnicketyField'
                            }
                        }
                    ]
                });
            });

            it('can modify validation schema using model.$beforeValidate().', () => {

                let seenSchema;
                let seenJson;
                let seenOptions;

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }

                    $beforeValidate(schema, json, options) {

                        seenSchema = schema;
                        seenJson = json;
                        seenOptions = options;

                        return schema.keys({
                            persnicketyField: Joi.string().max(1)
                        });
                    }
                };

                const instance = new Model();
                const persnickety = { persnicketyField: 'xxxxx' }; // Length of 5, bigger than max

                expect(() => instance.$validate(persnickety)).to.throw(Objection.ValidationError);
                expect(seenSchema).to.shallow.equal(Model.getJoiSchema());
                expect(seenJson).to.equal(persnickety);
                expect(seenOptions).to.equal({});
            });

            it('skips validation if model is missing joiSchema.', () => {

                const anythingGoes = new Schwifty.Model();

                const whateverSchema = {
                    anything: 'goes',
                    whatever: 8
                };

                expect(anythingGoes.$validate(whateverSchema)).to.equal(whateverSchema);
            });

            it('skips validation when `skipValidation` option is passed to $validate().', () => {

                const chompy = new TestModels.Zombie();

                const whateverSchema = {
                    anything: 'goes',
                    whatever: 8
                };

                expect(chompy.$validate(whateverSchema, { skipValidation: true })).to.equal(whateverSchema);
            });

            it('allows missing required properties when `patch` option is passed to $validate().', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object({
                            requiredField: Joi.any().required(),
                            hasDefault: Joi.any().default('mosdef') // should not appear after validation
                        });
                    }
                };

                const instance = new Model();
                const missingField = {};

                expect(instance.$validate(missingField, { patch: true })).to.equal(missingField);
            });
        });

        describe('static method getJoiSchema(patch)', () => {

            it('returns nothing when there\'s no Joi schema.', () => {

                expect(Schwifty.Model.getJoiSchema()).to.not.exist();
                expect(Schwifty.Model.getJoiSchema(true)).to.not.exist();
            });

            it('memoizes the plain schema.', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                expect(Model.getJoiSchema()).to.shallow.equal(Model.getJoiSchema());
            });

            it('memoizes the patch schema.', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                expect(Model.getJoiSchema()).to.not.shallow.equal(Model.getJoiSchema(true));
                expect(Model.getJoiSchema(true)).to.shallow.equal(Model.getJoiSchema(true));
            });

            it('forgets past memoization on extended classes.', () => {

                const ModelOne = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object({ a: Joi.any() });
                    }
                };

                const keysOf = (schema) => Object.keys(schema.describe().children || {});

                expect(keysOf(ModelOne.getJoiSchema())).to.only.include(['a']);
                expect(keysOf(ModelOne.getJoiSchema(true))).to.only.include(['a']);

                const ModelTwo = class extends ModelOne {
                    static get joiSchema() {

                        return super.joiSchema.keys({ b: Joi.any() });
                    }
                };

                expect(keysOf(ModelTwo.getJoiSchema())).to.only.include(['a', 'b']);
                expect(keysOf(ModelTwo.getJoiSchema(true))).to.only.include(['a', 'b']);
            });
        });

        describe('static getter jsonAttributes', () => {

            it('lists attributes that are specified as Joi objects or arrays.', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object({
                            arr: Joi.array(),
                            obj: Joi.object(),
                            str: Joi.string(),
                            num: Joi.number()
                        });
                    }
                };

                const jsonAttributes = Model.jsonAttributes;

                expect(jsonAttributes.length).to.equal(2);
                expect(jsonAttributes).to.contain(['arr', 'obj']);
            });

            it('returns null for a missing Joi schema.', () => {

                expect(Schwifty.Model.jsonAttributes).to.equal(null);
            });

            it('returns an empty array for an empty Joi schema.', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                expect(Model.jsonAttributes).to.equal([]);
            });

            it('is memoized.', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object({
                            arr: Joi.array(),
                            obj: Joi.object(),
                            str: Joi.string(),
                            num: Joi.number()
                        });
                    }
                };

                expect(Model.jsonAttributes).to.shallow.equal(Model.jsonAttributes);
            });

            it('if set, prefers set value.', () => {

                // Not affected by parent class

                Schwifty.Model.jsonAttributes = false;

                const ModelOne = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                expect(ModelOne.jsonAttributes).to.equal([]);

                // Prefers own set value

                const ModelTwo = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                ModelTwo.jsonAttributes = false;

                expect(ModelTwo.jsonAttributes).to.equal(false);
            });
        });

        describe('static setter jsonAttributes', () => {

            // A quick dip into unit (vs behavioral) testing!
            it('sets $$schwiftyJsonAttributes', () => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object({
                            arr: Joi.array(),
                            obj: Joi.object(),
                            str: Joi.string(),
                            num: Joi.number()
                        });
                    }
                };

                const jsonAttrs = Model.jsonAttributes;
                expect(jsonAttrs).to.equal(['arr', 'obj']);
                expect(jsonAttrs).to.shallow.equal(Model.$$schwiftyJsonAttributes);

                const emptyJsonAttrs = Model.jsonAttributes = [];
                expect(emptyJsonAttrs).to.shallow.equal(Model.$$schwiftyJsonAttributes);
            });
        });
    });

    describe('assertCompatible()', () => {

        const defaultErrorMsg = 'Models are incompatible.  One model must extend the other, they must have the same name, and share the same tableName.';

        it('throws if one model doesn\'t extend the other.', () => {

            const ModelA = class Named extends Objection.Model {};
            const ModelB = class Named extends Objection.Model {};

            expect(() => Schwifty.assertCompatible(ModelA, ModelB)).to.throw(defaultErrorMsg);
            expect(() => Schwifty.assertCompatible(ModelB, ModelA)).to.throw(defaultErrorMsg);
        });

        it('throws if one model doesn\'t have the same name as the other.', () => {

            const ModelA = class NameOne extends Objection.Model {};
            const ModelB = class NameTwo extends ModelA {};

            expect(() => Schwifty.assertCompatible(ModelA, ModelB)).to.throw(defaultErrorMsg);
            expect(() => Schwifty.assertCompatible(ModelB, ModelA)).to.throw(defaultErrorMsg);
        });

        it('throws if one model doesn\'t have the same table as the other.', () => {

            const ModelA = class Named extends Objection.Model {};
            ModelA.tableName = 'x';

            const ModelB = class Named extends ModelA {};
            ModelB.tableName = 'y';

            expect(() => Schwifty.assertCompatible(ModelA, ModelB)).to.throw(defaultErrorMsg);
            expect(() => Schwifty.assertCompatible(ModelB, ModelA)).to.throw(defaultErrorMsg);
        });

        it('throws with custom message.', () => {

            const ModelA = class NameOne extends Objection.Model {};
            const ModelB = class NameTwo extends ModelA {};
            const customMessage = 'Bad, very bad!';

            expect(() => Schwifty.assertCompatible(ModelA, ModelB, customMessage)).to.throw(customMessage);
        });

        it('no-ops when one model extends the other, they share the same name, and share the same table.', () => {

            const ModelA = class Named extends Objection.Model {};
            ModelA.tableName = 'x';

            const ModelB = class Named extends ModelA {};
            ModelB.tableName = 'x';

            expect(() => Schwifty.assertCompatible(ModelA, ModelB)).to.not.throw();
            expect(() => Schwifty.assertCompatible(ModelB, ModelA)).to.not.throw();
        });
    });

    describe('ownership', () => {

        it('of models applies to server\'s realm and its ancestors.', async () => {

            const makePlugin = (name, models, plugins) => ({
                name,
                async register(srv, options) {

                    await srv.register(plugins);
                    srv.schwifty(models);
                    srv.expose('models', () => srv.models());
                }
            });

            const ModelO = class ModelO extends Schwifty.Model {};
            const ModelA1 = class ModelA1 extends Schwifty.Model {};
            const ModelA1a = class ModelA1a extends Schwifty.Model {};
            const ModelA1b = class ModelA1b extends Schwifty.Model {};
            const ModelA2 = class ModelA2 extends Schwifty.Model {};
            const ModelX1a = class ModelX1a extends Schwifty.Model {};

            const server = Hapi.server();
            await server.register(Schwifty);

            const pluginX1a = makePlugin('pluginX1a', [], []);
            const pluginX1 = makePlugin('pluginX1', [ModelX1a], [pluginX1a]);
            const pluginX = makePlugin('pluginX', [], [pluginX1]);
            const pluginA1 = makePlugin('pluginA1', [ModelA1a, ModelA1b], []);
            const pluginA = makePlugin('pluginA', [ModelA1, ModelA2], [pluginA1, pluginX]);

            server.schwifty(ModelO);

            await server.register(pluginA);

            const {
                pluginX1a: X1a,
                pluginX1: X1,
                pluginX: X,
                pluginA1: A1,
                pluginA: A
            } = server.plugins;

            expect(X1a.models()).to.equal({});
            expect(X1.models()).to.only.contain([
                'ModelX1a'
            ]);
            expect(X.models()).to.only.contain([
                'ModelX1a'
            ]);
            expect(A1.models()).to.only.contain([
                'ModelA1a',
                'ModelA1b'
            ]);
            expect(A.models()).to.only.contain([
                'ModelA1',
                'ModelA1a',
                'ModelA1b',
                'ModelA2',
                'ModelX1a'
            ]);
            expect(server.models()).to.only.contain([
                'ModelO',
                'ModelA1',
                'ModelA1a',
                'ModelA1b',
                'ModelA2',
                'ModelX1a'
            ]);
        });

        it('of knex applies to server\'s realm and its children.', async () => {

            const makePlugin = (name, models, knex, plugins) => ({
                name,
                async register(srv, options) {

                    await srv.register(plugins);
                    srv.schwifty({ models, knex });
                    srv.expose('knex', () => srv.knex());
                }
            });

            // Required to bind knex (during server initialization) since objection v0.9.1

            const withTablename = (Model) => {

                return class extends Model {

                    static get tableName() {

                        return 'TableName';
                    }
                };
            };

            const ModelO = class ModelO extends withTablename(Schwifty.Model) {};
            const ModelA1 = class ModelA1 extends withTablename(Schwifty.Model) {};
            const ModelA1a = class ModelA1a extends withTablename(Schwifty.Model) {};
            const ModelA1b = class ModelA1b extends withTablename(Schwifty.Model) {};
            const ModelA2 = class ModelA2 extends withTablename(Schwifty.Model) {};
            const ModelX1a = class ModelX1a extends withTablename(Schwifty.Model) {};

            const knex1 = makeKnex();
            const knex2 = makeKnex();

            const server = Hapi.server();
            await server.register(Schwifty);

            const pluginX1a = makePlugin('pluginX1a', [], undefined, []);
            const pluginX1 = makePlugin('pluginX1', [ModelX1a], undefined, [pluginX1a]);
            const pluginX = makePlugin('pluginX', [], knex1, [pluginX1]);
            const pluginA1 = makePlugin('pluginA1', [ModelA1a, ModelA1b], undefined, []);
            const pluginA = makePlugin('pluginA', [ModelA1, ModelA2], knex2, [pluginA1, pluginX]);

            server.schwifty(ModelO);

            await server.register(pluginA);

            const {
                pluginX1a: X1a,
                pluginX1: X1,
                pluginX: X,
                pluginA1: A1,
                pluginA: A
            } = server.plugins;

            expect(X1a.knex()).to.shallow.equal(knex1);
            expect(X1.knex()).to.shallow.equal(knex1);
            expect(X.knex()).to.shallow.equal(knex1);
            expect(A1.knex()).to.shallow.equal(knex2);
            expect(A.knex()).to.shallow.equal(knex2);
            expect(server.knex()).to.equal(null);

            await server.initialize();

            const {
                ModelO: BoundModelO,
                ModelA1: BoundModelA1,
                ModelA1a: BoundModelA1a,
                ModelA1b: BoundModelA1b,
                ModelA2: BoundModelA2,
                ModelX1a: BoundModelX1a
            } = server.models();

            expect(BoundModelO.knex()).to.not.exist();
            expect(BoundModelA1.knex()).to.shallow.equal(knex2);
            expect(BoundModelA1a.knex()).to.shallow.equal(knex2);
            expect(BoundModelA1b.knex()).to.shallow.equal(knex2);
            expect(BoundModelA2.knex()).to.shallow.equal(knex2);
            expect(BoundModelX1a.knex()).to.shallow.equal(knex1);
        });
    });
});
