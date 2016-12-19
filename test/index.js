'use strict';

// Load modules

const Lab = require('lab');
const Code = require('code');
const Hapi = require('hapi');
const Path = require('path');
// const Knex = require('knex');
const ModelsFixture = require('./models');
const Schwifty = require('..');

// Test shortcuts

const lab = exports.lab = Lab.script();
const expect = Code.expect;
const describe = lab.describe;
const it = lab.it;

describe('Schwifty', () => {

    const getOptions = (includeModels) => {

        const options = JSON.parse(JSON.stringify({
            knexFile: {
                test: {
                    client: 'sqlite3',
                    connection: {
                        filename: ':memory:'
                    },
                    useNullAsDefault: true
                }
            }
        }));

        if (includeModels) {
            options.knexFile.models = ModelsFixture;
        }

        return options;
    };

    const getServer = (options, cb) => {

        const server = new Hapi.Server();

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

    const modelsFile = './models.js';

    const state = (server) => {

        return server.realm.plugins.schwifty;
    };

    it('decorates the Knex instance onto the server.', (done) => {

        getServer(getOptions(), (err, server) => {

            expect(err).not.to.exist();

            // Duck type the knex instance
            expect(server.knex.queryBuilder).to.exist();
            expect(server.knex.innerJoin).to.exist();
            expect(server.knex.where).to.exist();
            done();
        });
    });

    it('connects models to knex instance during onPreStart.', (done) => {

        const config = getOptions(true);

        getServer(config, (err, server) => {

            expect(err).to.not.exist();
            expect(server.models().dog.$$knex).to.not.exist();
            expect(server.models().person.$$knex).to.not.exist();

            server.initialize((err) => {

                expect(err).to.not.exist();
                expect(server.models().dog.$$knex).to.exist();
                expect(server.models().person.$$knex).to.exist();
                expect(server.models()).to.exist();
                done();
            });
        });
    });

    it('errors on Knex failure during onPreStart.', (done) => {

        const options = getOptions(true);

        options.knexFile.test.client = 'fakeConnection';

        getServer(options, (err, server) => {

            expect(err).to.exist();
            expect(err.message).to.equal('Cannot find module \'./dialects/fakeConnection/index.js\'');
            done();
        });
    });

    it('tears-down connections onPostStop.', (done) => {

        getServer(getOptions(), (err, server) => {

            let toredown = 0;
            expect(err).to.not.exist();

            server.initialize((err) => {

                expect(err).to.not.exist();
                expect(toredown).to.equal(0);

                server.ext('onPreStop', (srv, next) => {

                    // Monkeypatch the destroy func
                    const oldDestroy = srv.knex.destroy;
                    srv.knex.destroy = (...args) => {

                        ++toredown;
                        oldDestroy(...args);
                    };

                    expect(server.knex).to.exist();
                    next();
                });

                server.stop((err) => {

                    expect(err).to.not.exist();
                    expect(toredown).to.equal(1);
                    done();
                });
            });
        });
    });

    it('does not tear-down connections onPostStop with option `teardownOnStop` false.', (done) => {

        const options = getOptions();
        options.teardownOnStop = false;

        getServer(options, (err, server) => {

            let toredown = 0;
            expect(err).to.not.exist();

            server.initialize((err) => {

                expect(err).to.not.exist();
                expect(toredown).to.equal(0);

                server.ext('onPreStop', (srv, next) => {

                    // Monkeypatch the destroy func
                    const oldDestroy = srv.knex.destroy;
                    srv.knex.destroy = (...args) => {

                        ++toredown;
                        oldDestroy(...args);
                    };

                    expect(server.knex).to.exist();
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

    // it('can be registered multiple times.', (done) => {

    //     getServer(getOptions(), (err, server) => {

    //         console.log(server.registrations);
    //         expect(err).to.not.exist();
    //         expect(server.registrations.schwifty).to.exist();

    //         server.register(Schwifty, (err) => {

    //             expect(err).not.to.exist();
    //             done();
    //         });
    //     });
    // });

    describe('plugin registration', () => {

        it('takes `models` option as a relative path.', (done) => {

            const options = getOptions();

            options.models = Path.normalize('./test/' + modelsFile);

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const models = server.models();
                console.log(models);

                expect(models.dog).to.exist();
                expect(models.person).to.exist();

                done();
            });
        });

        it('takes `models` option as an absolute path.', (done) => {

            const options = getOptions();

            options.models = Path.normalize(__dirname + '/' + modelsFile);

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const models = server.models();
                expect(models.dog).to.exist();
                expect(models.person).to.exist();

                done();
            });
        });

        it('takes `models` option as an array of objects.', (done) => {

            const options = getOptions(true);

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const models = server.models();
                expect(models.dog).to.exist();
                expect(models.person).to.exist();

                done();
            });
        });

        it('throws if the `models` option is not an array or string.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: { some: 'object' }
            };

            expect(() => {

                getServer(options, () => {

                    return done(new Error('Should not make it here.'));
                });
            }).to.throw(/^Bad plugin options passed to schwifty\./);

            done();
        });

        it('takes `adapters` specified as a string.', (done) => {

            const adapters = { myAdapter: 'sails-memory' };

            const options = {
                connections,
                adapters,
                models: Path.normalize(__dirname + '/' + modelsFile)
            };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const collector = state(server).collector;
                expect(collector.adapters.myAdapter).to.shallow.equal(adapters.myAdapter);

                done();
            });
        });

        it('passes `defaults` option to Waterline.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: ModelsFixture,
                defaults: { migrate: 'safe' }
            };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                server.initialize((err) => {

                    expect(err).to.not.exist();

                    const collections = server.waterline.collections;
                    expect(collections.thismodel.migrate).to.equal('create');
                    expect(collections.thatmodel.migrate).to.equal('safe');

                    done();
                });
            });
        });

        it('throws when specific `defaults` are specified more than once.', (done) => {

            const options = { defaults: { x: 1 } };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.register({ options, register: Schwifty }, next);
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => done('Should not make it here.'));
                }).to.throw('Default for "x" has already been set.');

                done();
            });
        });

        it('throws when `teardownOnStop` is specified more than once.', (done) => {

            const options = { teardownOnStop: false };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.register({ options, register: Schwifty }, next);
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => done('Should not make it here.'));
                }).to.throw('Schwifty\'s teardownOnStop option can only be specified once.');

                done();
            });
        });
    });

    describe('server.schwifty() decoration', () => {

        it('aggregates models, connections, and adapters across plugins.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: ModelsFixture
            };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin1 = (srv, opts, next) => {

                    srv.schwifty({
                        connections: { oneConnection: { adapter: 'twoAdapter' } },
                        adapters: { oneAdapter: {} },
                        models: [{
                            identity: 'onemodel',
                            connection: 'twoConnection'
                        }]
                    });
                    next();
                };

                plugin1.attributes = { name: 'plugin-one' };

                const plugin2 = (srv, opts, next) => {

                    srv.schwifty({
                        connections: { twoConnection: { adapter: 'oneAdapter' } },
                        adapters: { twoAdapter: {} },
                        models: [{
                            identity: 'twomodel',
                            connection: 'oneConnection'
                        }]
                    });
                    next();
                };

                plugin2.attributes = { name: 'plugin-two' };

                server.register([plugin1, plugin2], (err) => {

                    expect(err).to.not.exist();

                    server.initialize((err) => {

                        expect(err).to.not.exist();

                        const waterline = server.waterline;
                        const collections = waterline.collections;
                        const conns = waterline.connections;

                        expect(collections.thismodel.identity).to.equal('thismodel');
                        expect(collections.thatmodel.identity).to.equal('thatmodel');
                        expect(collections.onemodel.identity).to.equal('onemodel');
                        expect(collections.twomodel.identity).to.equal('twomodel');

                        expect(conns.myConnection).to.contain({ config: { adapter: 'myAdapter' } });
                        expect(conns.oneConnection).to.contain({ config: { adapter: 'twoAdapter' } });
                        expect(conns.twoConnection).to.contain({ config: { adapter: 'oneAdapter' } });

                        done();
                    });
                });
            });
        });

        it('aggregates model definitions within a plugin.', (done) => {

            getServer({ models: [{ identity: 'strangemodel' }] }, (err, server) => {

                expect(err).to.not.exist();

                const rootState = state(server);
                expect(Object.keys(rootState.collector.models)).to.equal(['strangemodel']);

                const plugin = (srv, opts, next) => {

                    srv.schwifty(ModelsFixture[0]);
                    srv.schwifty(ModelsFixture[1]);
                    srv.app.myState = state(srv);
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();
                    expect(server.app.myState.models).to.equal(['thismodel', 'thatmodel']);
                    expect(Object.keys(rootState.collector.models)).to.only.contain([
                        'strangemodel',
                        'thismodel',
                        'thatmodel'
                    ]);

                    done();
                });
            });
        });

        it('accepts a single model definition.', (done) => {

            getServer({}, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty(ModelsFixture[0]);
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    const collector = state(server).collector;
                    expect(collector.models.thismodel).to.exist();

                    done();
                });
            });
        });

        it('accepts an array of model definitions.', (done) => {

            getServer({}, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty(ModelsFixture);
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                server.register(plugin, (err) => {

                    expect(err).to.not.exist();

                    const collector = state(server).collector;
                    expect(collector.models.thismodel).to.exist();
                    expect(collector.models.thatmodel).to.exist();

                    done();
                });
            });
        });

        it('throws on model identity collision.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: ModelsFixture
            };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty({ models: [{ identity: 'thismodel' }] });
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => done('Should not make it here.'));
                }).to.throw('Model definition with identity "thismodel" has already been registered.');

                done();
            });
        });

        it('throws on connection name collision.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: ModelsFixture
            };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty({ connections: { myConnection: {} } });
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => done('Should not make it here.'));
                }).to.throw('Connection "myConnection" has already been registered.');

                done();
            });
        });

        it('throws on adapter name collision.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: ModelsFixture
            };

            getServer(options, (err, server) => {

                expect(err).to.not.exist();

                const plugin = (srv, opts, next) => {

                    srv.schwifty({ adapters: { myAdapter: {} } });
                    next();
                };

                plugin.attributes = { name: 'my-plugin' };

                expect(() => {

                    server.register(plugin, () => done('Should not make it here.'));
                }).to.throw('Adapter "myAdapter" has already been registered.');

                done();
            });
        });
    });

    describe('request.collections() and server.collections() decorations', () => {

        it('return empty object before server initialization.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: ModelsFixture
            };

            getServer(options, (err, server) => {

                expect(err).not.to.exist();

                server.route({
                    path: '/',
                    method: 'get',
                    handler: (request, reply) => {

                        expect(request.collections()).to.equal({});
                        expect(request.collections(true)).to.equal({});
                        reply({ ok: true });
                    }
                });

                expect(server.collections()).to.equal({});
                expect(server.collections(true)).to.equal({});

                server.inject({ url: '/', method: 'get' }, (response) => {

                    expect(response.result).to.equal({ ok: true });
                    done();
                });
            });
        });

        it('solely return collections registered in route\'s realm by default.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: [ModelsFixture[0]]
            };

            getServer(options, (err, server) => {

                expect(err).not.to.exist();

                server.route({
                    path: '/root',
                    method: 'get',
                    handler: (request, reply) => {

                        const collections = request.collections();
                        expect(collections).to.have.length(1);
                        expect(collections.thismodel.identity).to.equal('thismodel');
                        reply({ ok: 'root' });
                    }
                });
                server.ext('onPreStart', (_, nxt) => {

                    const collections = server.collections();
                    expect(collections).to.have.length(1);
                    expect(collections.thismodel.identity).to.equal('thismodel');
                    nxt();
                });

                const plugin = (srv, opts, next) => {

                    srv.schwifty(ModelsFixture[1]);
                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request, reply) => {

                            const collections = request.collections();
                            expect(collections).to.have.length(1);
                            expect(collections.thatmodel.identity).to.equal('thatmodel');
                            reply({ ok: 'plugin' });
                        }
                    });
                    srv.ext('onPreStart', (_, nxt) => {

                        const collections = srv.collections();
                        expect(collections).to.have.length(1);
                        expect(collections.thatmodel.identity).to.equal('thatmodel');
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

        it('return empty object from if no models defined in route\'s realm.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: ModelsFixture
            };

            getServer(options, (err, server) => {

                expect(err).not.to.exist();

                const plugin = (srv, opts, next) => {

                    srv.route({
                        path: '/',
                        method: 'get',
                        handler: (request, reply) => {

                            const collections = request.collections();
                            expect(collections).to.be.an.object();
                            expect(collections).to.have.length(0);
                            reply({ ok: true });
                        }
                    });
                    srv.ext('onPreStart', (_, nxt) => {

                        const collections = srv.collections();
                        expect(collections).to.be.an.object();
                        expect(collections).to.have.length(0);
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

        it('return collections across all realms when passed true.', (done) => {

            const options = {
                connections,
                adapters: dummyAdapters,
                models: [ModelsFixture[0]]
            };

            getServer(options, (err, server) => {

                expect(err).not.to.exist();

                server.route({
                    path: '/root',
                    method: 'get',
                    handler: (request, reply) => {

                        const collections = request.collections(true);
                        expect(collections).to.have.length(2);
                        expect(collections.thismodel.identity).to.equal('thismodel');
                        expect(collections.thatmodel.identity).to.equal('thatmodel');
                        reply({ ok: 'root' });
                    }
                });
                server.ext('onPreStart', (_, nxt) => {

                    const collections = server.collections(true);
                    expect(collections).to.have.length(2);
                    expect(collections.thismodel.identity).to.equal('thismodel');
                    expect(collections.thatmodel.identity).to.equal('thatmodel');
                    nxt();
                });

                const plugin = (srv, opts, next) => {

                    srv.schwifty(ModelsFixture[1]);
                    srv.route({
                        path: '/plugin',
                        method: 'get',
                        handler: (request, reply) => {

                            const collections = request.collections(true);
                            expect(collections).to.have.length(2);
                            expect(collections.thismodel.identity).to.equal('thismodel');
                            expect(collections.thatmodel.identity).to.equal('thatmodel');
                            reply({ ok: 'plugin' });
                        }
                    });
                    srv.ext('onPreStart', (_, nxt) => {

                        const collections = srv.collections(true);
                        expect(collections).to.have.length(2);
                        expect(collections.thismodel.identity).to.equal('thismodel');
                        expect(collections.thatmodel.identity).to.equal('thatmodel');
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
});
