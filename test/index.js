'use strict';

// Load modules

const Lab = require('lab');
const Code = require('code');
const Hapi = require('hapi');
const Joi = require('joi');
const Hoek = require('hoek');
const Path = require('path');
const Fs = require('fs');
const Tmp = require('tmp');
const Objection = require('objection');
const Knex = require('knex');
const TestModels = require('./models');
const Schwifty = require('..');


// Test shortcuts

const lab = exports.lab = Lab.script();
const expect = Code.expect;
const describe = lab.describe;
const it = lab.it;

describe('Schwifty', () => {

    const getOptions = (extras) => {

        const options = {
            knex: {
                client: 'sqlite3',
                useNullAsDefault: true,
                connection: {
                    filename: ':memory:'
                }
            }
        };

        return Hoek.applyToDefaults(options, extras || {});
    };

    const getServer = (options, cb) => {

        const server = new Hapi.Server();
        server.connection();

        server.register({
            register: Schwifty,
            options
        }, (err) => {

            if (err) {
                return cb(err);
            }

            return cb(null, server);
        });
    };

    const modelsFile = './models/as-file.js';

    const state = (server) => {

        return server.realm.plugins.schwifty;
    };

    it('decorates the Knex instance onto the server.', (done) => {

        getServer(getOptions(), (err, server) => {

            expect(err).not.to.exist();

            // Duck type the knex instance
            expect(server.knex().queryBuilder).to.exist();
            expect(server.knex().innerJoin).to.exist();
            expect(server.knex().where).to.exist();
            done();
        });
    });

    it('connects models to knex instance during onPreStart.', (done) => {

        const config = getOptions({
            models: [
                TestModels.Dog,
                TestModels.Person
            ]
        });

        getServer(config, (err, server) => {

            expect(err).to.not.exist();
            expect(server.models().Dog.$$knex).to.not.exist();
            expect(server.models().Person.$$knex).to.not.exist();

            server.initialize((err) => {

                expect(err).to.not.exist();
                expect(server.models().Dog.$$knex).to.exist();
                expect(server.models().Person.$$knex).to.exist();
                done();
            });
        });
    });

    it('tears-down connections onPostStop.', (done) => {

        getServer(getOptions(), (err, server) => {

            let toredown = 0;
            expect(err).to.not.exist();

            server.initialize((err) => {

                expect(err).to.not.exist();
                expect(toredown).to.equal(0);

                const oldDestroy = server.knex().destroy;
                server.knex().destroy = (cb) => {

                    ++toredown;
                    return oldDestroy(cb);
                };

                server.stop((err) => {

                    expect(err).to.not.exist();
                    expect(toredown).to.equal(1);
                    done();
                });
            });
        });
    });

    it('tears-down all connections onPostStop.', (done) => {

        getServer(getOptions(), (err, server) => {

            let toredown = 0;
            expect(err).to.not.exist();

            server.initialize((err) => {

                expect(err).to.not.exist();
                expect(toredown).to.equal(0);

                const plugin1 = (srv, opts, next) => {

                    srv.schwifty(getOptions({
                        models: [
                            TestModels.Dog,
                            TestModels.Person
                        ]
                    }));

                    // Monkeypatch the destroy func
                    const oldDestroy = srv.knex().destroy;
                    srv.knex().destroy = (cb) => {

                        ++toredown;
                        return oldDestroy(cb);
                    };

                    next();
                };

                plugin1.attributes = { name: 'plugin-one' };

                const plugin2 = (srv, opts, next) => {

                    srv.schwifty([TestModels.Zombie]);

                    // Plugin 2 will use server.root's knex connection
                    expect(srv.knex()).to.shallow.equal(srv.root.knex());

                    next();
                };

                plugin2.attributes = { name: 'plugin-two' };

                const oldDestroy = server.knex().destroy;
                server.knex().destroy = (cb) => {

                    ++toredown;
                    return oldDestroy(cb);
                };

                server.register([plugin1, plugin2], (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.stop((err) => {

                            expect(err).to.not.exist();

                            // 2 pools were destroyed, plugin2 shared knex with the server root
                            expect(toredown).to.equal(2);
                            done();
                        });
                    });
                });
            });
        });
    });

    it('does not tear-down connections onPostStop with option `teardownOnStop` false.', (done) => {

        const options = getOptions({ teardownOnStop: false });

        getServer(options, (err, server) => {

            let toredown = 0;
            expect(err).to.not.exist();

            server.initialize((err) => {

                expect(err).to.not.exist();
                expect(toredown).to.equal(0);

                server.ext('onPreStop', (srv, next) => {

                    // Monkeypatch the destroy func
                    const oldDestroy = srv.knex().destroy;
                    srv.knex().destroy = (cb) => {

                        ++toredown;
                        return oldDestroy(cb);
                    };

                    expect(server.knex()).to.exist();
                    next();
                });

                server.stop((err) => {

                    expect(err).to.not.exist();
                    expect(toredown).to.equal(0);
                    done();
                });
            });
        });
    });

    it('can be registered multiple times.', (done) => {

        getServer(getOptions({
            models: [
                TestModels.Dog,
                TestModels.Person
            ]
        }), (err, server) => {

            expect(err).to.not.exist();
            expect(server.registrations.schwifty).to.exist();

            server.register({
                register: Schwifty,
                options: { models: [TestModels.Movie, TestModels.Zombie] }
            }, (err) => {

                expect(err).not.to.exist();

                // Ensure all models got added
                expect(Object.keys(server.models())).to.only.contain([
                    'Dog',
                    'Person',
                    'Movie',
                    'Zombie'
                ]);

                done();
            });
        });
    });

    describe('plugin registration', () => {

        it('takes `models` option as a relative path.', (done) => {

            const options = getOptions({ models: Path.normalize('./test/' + modelsFile) });

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const models = server.models();

                expect(models.Dog).to.exist();
                expect(models.Person).to.exist();

                done();
            });
        });

        it('takes `models` option as an absolute path.', (done) => {

            const options = getOptions({ models: Path.normalize(__dirname + '/' + modelsFile) });

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const models = server.models();
                expect(models.Dog).to.exist();
                expect(models.Person).to.exist();

                done();
            });
        });

        it('takes `models` option as an array of objects.', (done) => {

            const options = getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            });

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const models = server.models();
                expect(models.Dog).to.exist();
                expect(models.Person).to.exist();

                done();
            });
        });

        it('throws if the `models` option is not an array or string.', (done) => {

            const options = getOptions({ models: {} });

            expect(() => {

                getServer(options, () => {

                    return done(new Error('Should not make it here.'));
                });
            }).to.throw(/^Bad plugin options passed to schwifty\./);

            done();
        });

        it('throws when `teardownOnStop` is specified more than once.', (done) => {

            const options = getOptions({ teardownOnStop: false });

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.register({ options, register: Schwifty }, next);
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => done('Should not make it here.'));
                }).to.throw('Schwifty\'s teardownOnStop option can only be specified once.');
                // }).to.throw(/Schwifty\'s teardownOnStop option can only be specified once./);

                done();
            });
        });

        it('throws when `migrateOnStart` is specified more than once.', (done) => {

            getServer({ migrateOnStart: false }, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.register({ register: Schwifty, options: { migrateOnStart: false } }, next);
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => done(new Error('Should not make it here.')));
                }).to.throw('Schwifty\'s migrateOnStart option can only be specified once.');

                done();
            });
        });
    });

    describe('server.schwifty() decoration', () => {

        it('aggregates models across plugins.', (done) => {

            const options = getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            });

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin1 = (srv, opts, next) => {

                    srv.schwifty({
                        models: [TestModels.Movie]
                    });
                    next();
                };

                plugin1.attributes = { name: 'plugin-one' };

                const plugin2 = (srv, opts, next) => {

                    srv.schwifty({
                        models: [TestModels.Zombie]
                    });
                    next();
                };

                plugin2.attributes = { name: 'plugin-two' };

                server.register([plugin1, plugin2], (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        // Grab all models across plugins by passing true here:
                        const models = server.models(true);

                        expect(models.Dog.tableName).to.equal('Dog');
                        expect(models.Person.tableName).to.equal('Person');
                        expect(models.Zombie.tableName).to.equal('Zombie');
                        expect(models.Movie.tableName).to.equal('Movie');

                        done();
                    });
                });
            });
        });

        it('aggregates model definitions within a plugin.', (done) => {

            getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }), (err, server) => {

                expect(err).to.not.exist();

                const rootState = state(server.root);
                expect(Object.keys(rootState.collector.models)).to.equal(['Dog', 'Person']);

                const plugin = (srv, opts, next) => {

                    srv.schwifty({
                        models: [TestModels.Movie]
                    });
                    srv.schwifty({
                        models: [TestModels.Zombie]
                    });

                    srv.app.myState = state(srv);
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        expect(server.app.myState.knexGroup.models).to.equal(['Movie', 'Zombie']);

                        expect(Object.keys(rootState.collector.models)).to.only.contain([
                            'Dog',
                            'Person',
                            'Movie',
                            'Zombie'
                        ]);

                        done();
                    });
                });
            });
        });

        it('accepts a single model definition.', (done) => {

            getServer(getOptions(), (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty(TestModels.Zombie);
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    const collector = state(server).collector;
                    expect(collector.models.Zombie).to.exist();

                    done();
                });
            });
        });

        it('accepts `knex` as a knex instance.', (done) => {

            const options = getOptions();
            delete options.knex;

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const knex = Knex({});

                const plugin = (srv, opts, next) => {

                    srv.schwifty({ knex });
                    expect(srv.knex()).to.shallow.equal(knex);
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, done);
            });
        });

        it('throws on invalid config', (done) => {

            getServer(getOptions(), (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    expect(() => {

                        srv.schwifty({ invalidProp: 'bad' });
                    }).to.throw(/\"invalidProp\" is not allowed/);

                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();
                    done();
                });
            });
        });

        it('throws on model name collision.', (done) => {

            getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }), (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty(TestModels.Dog);
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => {

                        throw new Error('Should not make it here.');
                    });
                }).to.throw('Model "Dog" has already been registered.');

                done();
            });
        });
    });

    describe('request.knex() and server.knex() decorations', () => {

        it('allows plugins to have a different knex instances than the root server', (done) => {

            getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }), (err, server) => {

                expect(err).to.not.exist();

                const plugin1 = (srv, opts, next) => {

                    srv.schwifty(TestModels.Zombie);

                    srv.route({
                        path: '/pluginOne',
                        method: 'get',
                        handler: (request, reply) => {

                            expect(request.knex()).to.shallow.equal(srv.root.knex());
                            reply({ ok: true });
                        }
                    });

                    // This plugin only passes in models so it's connection is the default (same as root server)
                    expect(srv.knex()).to.shallow.equal(srv.root.knex());
                    next();
                };

                plugin1.attributes = { name: 'plugin-one' };

                const plugin2 = (srv, opts, next) => {

                    const options = getOptions({ models: [TestModels.Movie] }); // New knex instance

                    srv.schwifty(options);

                    srv.route({
                        path: '/pluginTwo',
                        method: 'get',
                        handler: (request, reply) => {

                            expect(request.knex()).to.not.shallow.equal(srv.root.knex());
                            reply({ ok: true });
                        }
                    });

                    expect(srv.knex()).to.not.shallow.equal(srv.root.knex());
                    next();
                };

                plugin2.attributes = { name: 'plugin-two' };

                server.register([plugin1, plugin2], (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.inject({ url: '/pluginOne', method: 'get' }, (res1) => {

                            expect(res1.result).to.equal({ ok: true });

                            server.inject({ url: '/pluginTwo', method: 'get' }, (res2) => {

                                expect(res2.result).to.equal({ ok: true });
                                done();
                            });
                        });
                    });
                });
            });
        });

        it('throws when multiple knex instances passed to same server', (done) => {

            getServer(getOptions(), (err, server) => {

                expect(err).to.not.exist();
                expect(server.registrations.schwifty).to.exist();

                expect(() => {

                    server.register({
                        register: Schwifty,
                        options: getOptions()
                    }, (ignoreErr) => {

                        return done(new Error('Should not make it here.'));
                    });
                }).to.throw('A knex instance/config may be specified only once per server or plugin.');

                done();
            });
        });

        it('throws when multiple knex instances passed to same plugin', (done) => {

            getServer({}, (err, server) => {

                expect(err).to.not.exist();
                expect(server.registrations.schwifty).to.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty({ knex: Knex({}) });

                    expect(() => {

                        srv.schwifty({ knex: Knex({}) });
                    }).to.throw('A knex instance/config may be specified only once per server or plugin.');

                    done();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (ignoreErr) => {

                    throw new Error('Shouldn\'t make it here');
                });
            });
        });
    });

    describe('migrations', () => {

        it('does not run by default.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/basic'
            }), (err, server) => {

                expect(err).to.not.exist();

                server.knex().migrate.currentVersion().asCallback((err, versionPre) => {

                    expect(err).to.not.exist();
                    expect(versionPre).to.equal('none');

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.knex().migrate.currentVersion().asCallback((err, versionPost) => {

                            expect(err).to.not.exist();
                            expect(versionPost).to.equal('none');

                            done();
                        });
                    });
                });
            });
        });

        it('does not run when `migrateOnStart` plugin/server option is `false`.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: false
            }), (err, server) => {

                expect(err).to.not.exist();

                server.knex().migrate.currentVersion().asCallback((err, versionPre) => {

                    expect(err).to.not.exist();
                    expect(versionPre).to.equal('none');

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.knex().migrate.currentVersion().asCallback((err, versionPost) => {

                            expect(err).to.not.exist();
                            expect(versionPost).to.equal('none');

                            done();
                        });
                    });
                });
            });
        });

        it('migrates to latest when `migrateOnStart` plugin/server option is `true`.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }), (err, server) => {

                expect(err).to.not.exist();

                server.knex().migrate.currentVersion().asCallback((err, versionPre) => {

                    expect(err).to.not.exist();
                    expect(versionPre).to.equal('none');

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.knex().migrate.currentVersion().asCallback((err, versionPost) => {

                            expect(err).to.not.exist();
                            expect(versionPost).to.equal('basic.js');

                            done();
                        });
                    });
                });
            });
        });

        it('migrates to latest when `migrateOnStart` plugin/server option is `\'latest\'`.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: 'latest'
            }), (err, server) => {

                expect(err).to.not.exist();

                server.knex().migrate.currentVersion().asCallback((err, versionPre) => {

                    expect(err).to.not.exist();
                    expect(versionPre).to.equal('none');

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.knex().migrate.currentVersion().asCallback((err, versionPost) => {

                            expect(err).to.not.exist();
                            expect(versionPost).to.equal('basic.js');

                            done();
                        });
                    });
                });
            });
        });

        it('rollsback when `migrateOnStart` plugin/server option is `\'rollback\'`.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }), (err, server1) => {

                expect(err).to.not.exist();

                server1.initialize((err) => {

                    expect(err).to.not.exist();

                    server1.knex().migrate.currentVersion().asCallback((err, versionPre) => {

                        expect(err).to.not.exist();
                        expect(versionPre).to.equal('basic.js');

                        getServer({
                            knex: server1.knex(),
                            migrationsDir: './test/migrations/basic',
                            migrateOnStart: 'rollback'
                        }, (err, server2) => {

                            expect(err).to.not.exist();

                            expect(server1.knex()).to.shallow.equal(server2.knex());

                            server2.initialize((err) => {

                                expect(err).to.not.exist();

                                server2.knex().migrate.currentVersion().asCallback((err, versionPost) => {

                                    expect(err).to.not.exist();
                                    expect(versionPost).to.equal('none');

                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });

        it('accepts absolute `migrationsDir`s.', (done) => {

            getServer(getOptions({
                migrationsDir: Path.join(process.cwd(), 'test/migrations/basic'),
                migrateOnStart: true
            }), (err, server) => {

                expect(err).to.not.exist();

                server.initialize((err) => {

                    expect(err).to.not.exist();

                    server.knex().migrate.currentVersion().asCallback((err, version) => {

                        expect(err).to.not.exist();
                        expect(version).to.equal('basic.js');

                        done();
                    });
                });
            });
        });

        it('coalesces migrations in different directories across plugins sharing knex instances.', (done) => {

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

            const makePlugin = (id, knex, migrationsDir) => {

                const plugin = (server, options, next) => {

                    server.schwifty({ knex, migrationsDir });
                    next();
                };

                plugin.attributes = { name: `plugin-${id}` };

                return plugin;
            };

            const knex1 = makeKnex();
            const knex2 = makeKnex();

            getServer({
                knex: knex1,
                migrateOnStart: true
            }, (err, server) => {

                expect(err).to.not.exist();

                const plugin1 = makePlugin(1, knex1, './test/migrations/basic');
                const plugin2 = makePlugin(2, knex2, './test/migrations/basic');
                const plugin3 = makePlugin(3, undefined, './test/migrations/extras-one');
                const plugin4 = makePlugin(4, knex2, './test/migrations/extras-two');
                const plugin5 = makePlugin(5, knex1);

                server.register([
                    plugin1,
                    plugin2,
                    plugin3,
                    plugin4,
                    plugin5
                ], (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        knex1('TestMigrations').columns('name').orderBy('name', 'asc').asCallback((err, migrations1) => {

                            expect(err).to.not.exist();

                            knex2('TestMigrations').columns('name').orderBy('name', 'asc').asCallback((err, migrations2) => {

                                expect(err).to.not.exist();

                                const getName = (x) => x.name;

                                expect(migrations1.map(getName)).to.equal(['basic.js', 'extras-one-1st.js', 'extras-one-2nd.js']);
                                expect(migrations2.map(getName)).to.equal(['basic.js', 'extras-two-1st.js', 'extras-two-2nd.js']);

                                done();
                            });
                        });
                    });
                });
            });
        });

        it('ignores non-migration files.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/non-migration',
                migrateOnStart: true
            }), (err, server) => {

                expect(err).to.not.exist();

                server.initialize((err) => {

                    expect(err).to.not.exist();

                    server.knex().migrate.currentVersion().asCallback((err, version) => {

                        expect(err).to.not.exist();

                        // If 2nd-bad had run, that would be the current version, due to sort order
                        expect(version).to.equal('1st-good.js');

                        done();
                    });
                });
            });
        });

        it('bails when failing to make a temp migrations directory.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }), (err, server) => {

                expect(err).to.not.exist();

                const origTmpDir = Tmp.dir;
                Tmp.dir = (opts, cb) => {

                    Tmp.dir = origTmpDir;
                    cb(new Error('Generating temp dir failed.'));
                };

                server.initialize((err) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Generating temp dir failed.');

                    server.knex().migrate.currentVersion().asCallback((err, version) => {

                        expect(err).to.not.exist();
                        expect(version).to.equal('none');

                        done();
                    });
                });
            });
        });

        it('bails when failing to read a migrations directory.', (done) => {

            getServer(getOptions({
                migrationsDir: './test/migrations/basic',
                migrateOnStart: true
            }), (err, server) => {

                expect(err).to.not.exist();

                const origReaddir = Fs.readdir;
                Fs.readdir = (opts, cb) => {

                    Fs.readdir = origReaddir;
                    cb(new Error('Reading migrations dir failed.'));
                };

                server.initialize((err) => {

                    expect(err).to.exist();
                    expect(err.message).to.equal('Reading migrations dir failed.');

                    server.knex().migrate.currentVersion().asCallback((err, version) => {

                        expect(err).to.not.exist();
                        expect(version).to.equal('none');

                        done();
                    });
                });
            });
        });
    });

    describe('request.models() and server.models() decorations', () => {

        it('return empty object before server initialization.', (done) => {

            getServer(getOptions(), (err, server) => {

                expect(err).not.to.exist();

                server.route({
                    path: '/',
                    method: 'get',
                    handler: (request, reply) => {

                        expect(request.models()).to.equal({});
                        expect(request.models(true)).to.equal({});
                        reply({ ok: true });
                    }
                });

                expect(server.models()).to.equal({});
                expect(server.models(true)).to.equal({});

                server.inject({ url: '/', method: 'get' }, (response) => {

                    expect(response.result).to.equal({ ok: true });
                    done();
                });
            });
        });

        it('return empty object if no models have been added', (done) => {

            getServer(getOptions(), (err, server) => {

                expect(err).not.to.exist();

                server.route({
                    path: '/root',
                    method: 'get',
                    handler: (request, reply) => {

                        expect(request.models()).to.equal({});
                        expect(request.models(true)).to.equal({});
                        reply({ ok: 'root' });
                    }

                });

                expect(state(server).knexGroup.models).to.equal([]);

                expect(server.models()).to.equal({});
                expect(server.models(true)).to.equal({});


                // Plugin here to show that models() defaults to [] (schwifty isn't called)
                const plugin = (srv, opts, next) => {

                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request, reply) => {

                            const _knexGroupId = state(srv);
                            expect(_knexGroupId).to.not.exist();
                            const models = request.models();
                            expect(models).to.equal({});
                            reply({ ok: 'plugin' });
                        }
                    });

                    next();
                };

                plugin.attributes = { name: 'my-plugin' };


                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.inject({ url: '/root', method: 'get' }, (res1) => {

                            expect(res1.result).to.equal({ ok: 'root' });

                            server.inject({ url: '/plugin', method: 'get' }, (res2) => {

                                expect(res2.result).to.equal({ ok: 'plugin' });
                                done();
                            });
                        });
                    });
                });
            });
        });

        it('solely return models registered in route\'s realm by default.', (done) => {

            getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }), (err, server) => {

                expect(err).not.to.exist();

                server.route({
                    path: '/root',
                    method: 'get',
                    handler: (request, reply) => {

                        const models = request.models();
                        expect(models).to.have.length(2);
                        expect(models.Dog.tableName).to.equal('Dog');
                        expect(models.Person.tableName).to.equal('Person');
                        reply({ ok: 'root' });
                    }
                });
                server.ext('onPreStart', (_, nxt) => {

                    const models = server.models();
                    expect(models).to.have.length(2);
                    expect(models.Dog.tableName).to.equal('Dog');
                    expect(models.Person.tableName).to.equal('Person');
                    nxt();
                });

                const plugin = (srv, opts, next) => {

                    srv.schwifty(TestModels.Movie);
                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request, reply) => {

                            const models = request.models();
                            expect(models).to.have.length(1);
                            expect(models.Movie.tableName).to.equal('Movie');
                            reply({ ok: 'plugin' });
                        }
                    });
                    srv.ext('onPreStart', (_, nxt) => {

                        const models = srv.models();
                        expect(models).to.have.length(1);
                        expect(models.Movie.tableName).to.equal('Movie');
                        nxt();
                    });
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.inject({ url: '/root', method: 'get' }, (res1) => {

                            expect(res1.result).to.equal({ ok: 'root' });

                            server.inject({ url: '/plugin', method: 'get' }, (res2) => {

                                expect(res2.result).to.equal({ ok: 'plugin' });
                                done();
                            });
                        });
                    });
                });
            });
        });

        it('return empty object if no models defined in route\'s realm.', (done) => {

            getServer(getOptions(), (err, server) => {

                expect(err).not.to.exist();

                const plugin = (srv, opts, next) => {

                    srv.route({
                        path: '/',
                        method: 'get',
                        handler: (request, reply) => {

                            const models = request.models();
                            expect(models).to.be.an.object();
                            expect(Object.keys(models)).to.have.length(0);
                            reply({ ok: true });
                        }
                    });
                    srv.ext('onPreStart', (_, nxt) => {

                        const models = srv.models();
                        expect(models).to.be.an.object();
                        expect(Object.keys(models)).to.have.length(0);
                        nxt();
                    });
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.inject({ url: '/', method: 'get' }, (response) => {

                            expect(response.result).to.equal({ ok: true });
                            done();
                        });
                    });
                });
            });
        });

        it('return models across all realms when passed true.', (done) => {

            getServer(getOptions({
                models: [
                    TestModels.Dog,
                    TestModels.Person
                ]
            }), (err, server) => {

                expect(err).not.to.exist();

                server.route({
                    path: '/root',
                    method: 'get',
                    handler: (request, reply) => {

                        const models = request.models(true);
                        expect(models).to.have.length(3);
                        expect(models.Dog.tableName).to.equal('Dog');
                        expect(models.Person.tableName).to.equal('Person');
                        expect(models.Zombie.tableName).to.equal('Zombie');
                        reply({ ok: 'root' });
                    }
                });
                server.ext('onPreStart', (_, nxt) => {

                    const models = server.models(true);
                    expect(models).to.have.length(3);
                    expect(models.Dog.tableName).to.equal('Dog');
                    expect(models.Person.tableName).to.equal('Person');
                    expect(models.Zombie.tableName).to.equal('Zombie');
                    nxt();
                });

                const plugin = (srv, opts, next) => {

                    srv.schwifty([TestModels.Zombie]);
                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request, reply) => {

                            const models = request.models(true);
                            expect(models).to.have.length(3);
                            expect(models.Dog.tableName).to.equal('Dog');
                            expect(models.Person.tableName).to.equal('Person');
                            expect(models.Zombie.tableName).to.equal('Zombie');
                            reply({ ok: 'plugin' });
                        }
                    });
                    srv.ext('onPreStart', (_, nxt) => {

                        const models = srv.models(true);
                        expect(models).to.have.length(3);
                        expect(models.Dog.tableName).to.equal('Dog');
                        expect(models.Person.tableName).to.equal('Person');
                        expect(models.Zombie.tableName).to.equal('Zombie');
                        nxt();
                    });
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        server.inject({ url: '/root', method: 'get' }, (res1) => {

                            expect(res1.result).to.equal({ ok: 'root' });

                            server.inject({ url: '/plugin', method: 'get' }, (res2) => {

                                expect(res2.result).to.equal({ ok: 'plugin' });
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    describe('Model', () => {

        describe('$validate()', () => {

            it('validates correct schema input.', (done) => {

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

                done();
            });

            it('defaults to validate itself if no json passed.', (done) => {

                const chompy = new TestModels.Zombie();
                chompy.firstName = 'Chompy';

                const validateRes = chompy.$validate();

                expect(validateRes).to.equal({
                    firstName: 'Chompy',
                    favoriteFood: 'Tasty brains'
                });

                done();
            });

            it('throws Objection.ValidationError if required schema item not provided to $validate().', (done) => {

                const chompy = new TestModels.Zombie();

                expect(() => {

                    chompy.$validate({
                        lastName: 'Chomperson'
                    });
                }).to.throw(Objection.ValidationError, /\\\"firstName\\\" is required/);

                done();
            });

            it('throws Objection.ValidationError if bad types are passed.', (done) => {

                const chompy = new TestModels.Zombie();

                expect(() => {

                    chompy.$validate({
                        firstName: 'Chompy',
                        lastName: 1234
                    });
                }).to.throw(Objection.ValidationError, /\\\"lastName\\\" must be a string/);

                done();
            });

            it('skips validation if model is missing joiSchema.', (done) => {

                const anythingGoes = new Schwifty.Model();

                const whateverSchema = {
                    anything: 'goes',
                    whatever: 8
                };

                expect(anythingGoes.$validate(whateverSchema)).to.equal(whateverSchema);

                done();
            });

            it('skips validation when `skipValidation` option is passed to $validate().', (done) => {

                const chompy = new TestModels.Zombie();

                const whateverSchema = {
                    anything: 'goes',
                    whatever: 8
                };

                expect(chompy.$validate(whateverSchema, { skipValidation: true })).to.equal(whateverSchema);

                done();
            });

            it('allows missing required properties when `patch` option is passed to $validate().', (done) => {

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

                done();
            });
        });

        describe('static method getJoiSchema(patch)', () => {

            it('returns nothing when there\'s no Joi schema.', (done) => {

                expect(Schwifty.Model.getJoiSchema()).to.not.exist();
                expect(Schwifty.Model.getJoiSchema(true)).to.not.exist();

                done();
            });

            it('memoizes the plain schema.', (done) => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                expect(Model.getJoiSchema()).to.shallow.equal(Model.getJoiSchema());

                done();
            });

            it('memoizes the patch schema.', (done) => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                expect(Model.getJoiSchema()).to.not.shallow.equal(Model.getJoiSchema(true));
                expect(Model.getJoiSchema(true)).to.shallow.equal(Model.getJoiSchema(true));

                done();
            });
        });

        describe('static getter jsonAttributes', () => {

            it('lists attributes that are specified as Joi objects or arrays.', (done) => {

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

                done();
            });

            it('returns null for a missing Joi schema.', (done) => {

                expect(Schwifty.Model.jsonAttributes).to.equal(null);

                done();
            });

            it('returns an empty array for an empty Joi schema.', (done) => {

                const Model = class extends Schwifty.Model {
                    static get joiSchema() {

                        return Joi.object();
                    }
                };

                expect(Model.jsonAttributes).to.equal([]);

                done();
            });

            it('is memoized.', (done) => {

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

                done();
            });
        });

        describe('static setter jsonAttributes', () => {

            it('sets _jsonAttributesMemo', (done) => {

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
                expect(jsonAttrs).to.equal(Model._jsonAttributesMemo);

                done();
            });
        });
    });
});
