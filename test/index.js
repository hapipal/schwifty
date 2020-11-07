'use strict';

// Load modules

const Fs = require('fs');
const Path = require('path');
const Util = require('util');
const Lab = require('@hapi/lab');
const Code = require('@hapi/code');
const Hoek = require('@hapi/hoek');
const Hapi = require('@hapi/hapi');
const Ahem = require('@hapipal/ahem');
const Objection = require('objection');
const Knex = require('knex');
const Joi = require('joi');
const TestModels = require('./models');
const Schwifty = require('..');

// Test shortcuts

const { describe, it, before } = exports.lab = Lab.script();
const { expect } = Code;

describe('Schwifty', () => {

    const basicKnexConfig = {
        client: 'sqlite3',
        useNullAsDefault: true,
        connection: {
            filename: ':memory:'
        }
    };

    const getOptions = (extras = {}) => {

        const options = { knex: basicKnexConfig };

        return Hoek.applyToDefaults(options, extras);
    };

    const makeKnex = () => {

        return Knex({
            ...basicKnexConfig,
            migrations: {
                tableName: 'TestMigrations'
            }
        });
    };

    const getServer = async (options) => {

        const server = Hapi.server();

        await server.register({
            plugin: Schwifty,
            options
        });

        return server;
    };

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

    const getPlugin = async (server, name, others) => {

        const register = () => null;

        return await Ahem.instance(server, { name, register, ...others }, {}, { controlled: false });
    };

    const sandbox = (Model) => {

        return class extends Model {
            static get name() {

                return Model.name;
            }
            static get [Schwifty.sandbox]() {

                return true;
            }
        };
    };

    // Just warm-up sqlite, so that the tests have consistent timing
    before(() => require('sqlite3'));

    it('can be registered multiple times.', async () => {

        const server = Hapi.server();

        await server.register(Schwifty);

        expect(server.registrations['@hapipal/schwifty']).to.exist();

        await server.register({
            plugin: Schwifty,
            options: { knex: basicKnexConfig }
        });

        expect(server.knex()).to.exist();
    });

    it('connects models to knex instance during onPreStart.', async () => {

        const server = await getServer({ knex: basicKnexConfig });

        server.registerModel(TestModels.Dog);
        server.registerModel(TestModels.Person);

        expect(server.models().Dog.knex()).to.not.exist();
        expect(server.models().Person.knex()).to.not.exist();

        await server.initialize();

        expect(server.models().Dog.knex()).to.exist();
        expect(server.models().Person.knex()).to.exist();
    });

    it('tears-down connections onPostStop.', async () => {

        const server = await getServer({ knex: basicKnexConfig });
        let toredown = 0;

        const origDestroy = server.knex().context.destroy;
        server.knex().context.destroy = () => {

            ++toredown;
            return origDestroy.call(server.knex());
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
            register: async (srv) => {

                await srv.register({ plugin: Schwifty, options: { knex: basicKnexConfig } });

                srv.registerModel(TestModels.Dog);
                srv.registerModel(TestModels.Person);

                expect(srv.knex()).to.not.shallow.equal(server.knex());

                const origDestroy = srv.knex().context.destroy;
                srv.knex().context.destroy = () => {

                    ++toredown;
                    return origDestroy.call(srv.knex());
                };
            }
        };

        const plugin2 = {
            name: 'plugin-two',
            register: (srv) => {

                srv.registerModel([TestModels.Zombie]);

                // Plugin 2 will use the root server's (referenced by server variable) knex connection
                expect(srv.knex()).to.shallow.equal(server.knex());

                const origDestroy = srv.knex().context.destroy;
                srv.knex().context.destroy = () => {

                    ++toredown;
                    return origDestroy.call(srv.knex());
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

        const origDestroy = server.knex().context.destroy;
        server.knex().context.destroy = () => {

            ++toredown;
            return origDestroy.call(server.knex());
        };

        server.ext('onPreStop', () => {

            expect(server.knex()).to.exist();
        });

        await server.initialize();
        await server.stop();

        expect(toredown).to.equal(0);
    });

    describe('plugin registration', () => {

        it('accepts `knex` as a knex instance.', async () => {

            const server = await getServer();
            const knex = Knex(basicKnexConfig);

            const plugin = {
                name: 'my-plugin',
                register: async (srv) => {

                    await srv.register({
                        plugin: Schwifty,
                        options: { knex }
                    });

                    expect(srv.knex()).to.shallow.equal(knex);
                }
            };

            await server.register(plugin);
        });

        it('throws when passed invalid plugin options.', async () => {

            const server = Hapi.server();

            await expect(server.register({
                plugin: Schwifty,
                options: []
            })).to.reject('Bad plugin options passed to schwifty. "value" must be of type object');
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

        it('throws when multiple knex instances passed to root server.', async () => {

            const server = Hapi.server();

            await server.register({
                plugin: Schwifty,
                options: { knex: Knex(basicKnexConfig) }
            });

            await expect(server.register({
                plugin: Schwifty,
                options: { knex: Knex(basicKnexConfig) }
            })).to.reject('A knex instance/config may be specified only once per server or plugin.');
        });

        it('throws when multiple knex instances passed to same plugin.', async () => {

            const server = await getServer();

            const plugin = {
                name: 'my-plugin',
                register: async (srv) => {

                    await srv.register({
                        plugin: Schwifty,
                        options: { knex: Knex(basicKnexConfig) }
                    });

                    await expect(srv.register({
                        plugin: Schwifty,
                        options: { knex: Knex(basicKnexConfig) }
                    })).to.reject('A knex instance/config may be specified only once per server or plugin.');
                }
            };

            await server.register(plugin);
        });
    });

    describe('server.registerModel() decoration', () => {

        it('accepts a single model.', async () => {

            const server = await getServer();

            server.registerModel(TestModels.Dog);

            const models = server.models();

            expect(models.Dog).to.exist();
        });

        it('accepts an array of models.', async () => {

            const server = await getServer();

            server.registerModel([TestModels.Dog, TestModels.Person]);

            const models = server.models();

            expect(models.Dog).to.exist();
            expect(models.Person).to.exist();
        });

        it('throws when passed something other than a single or array of models.', async () => {

            const server = await getServer();

            expect(() => server.registerModel({})).to.throw('Invalid models passed to server.registerModel(). "value" must be of type function');
        });

        it('aggregates models across plugins.', async () => {

            const server = await getServer(getOptions());

            server.registerModel([TestModels.Dog, TestModels.Person]);

            const plugin1 = {
                name: 'plugin-one',
                register: (srv) => {

                    srv.registerModel(TestModels.Movie);
                }
            };

            const plugin2 = {
                name: 'plugin-two',
                register: (srv) => {

                    srv.registerModel(TestModels.Zombie);
                }
            };

            await server.register([plugin1, plugin2]);
            await server.initialize();

            const models = server.models();

            expect(models).to.only.contain([
                'Dog',
                'Person',
                'Zombie',
                'Movie'
            ]);

            expect(models.Dog.tableName).to.equal('Dog');
            expect(models.Person.tableName).to.equal('Person');
            expect(models.Zombie.tableName).to.equal('Zombie');
            expect(models.Movie.tableName).to.equal('Movie');
        });

        it('aggregates model definitions within a plugin.', async () => {

            const server = await getServer(getOptions());

            server.registerModel([TestModels.Dog, TestModels.Person]);

            const rootState = state(getRootRealm(server));
            expect(Object.keys(rootState.models)).to.equal(['Dog', 'Person']);

            const plugin = {
                name: 'my-plugin',
                register: (srv) => {

                    srv.registerModel(TestModels.Movie);
                    srv.registerModel(TestModels.Zombie);

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

        it('sandboxes services in the current plugin when using Schmervice.sandbox symbol.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            server.registerModel(class ModelA extends Schwifty.Model {});

            const plugin = await getPlugin(server, 'plugin');

            plugin.registerModel(class ModelA extends Schwifty.Model {
                static get [Schwifty.sandbox]() {

                    return true;
                }
            });

            plugin.registerModel(class ModelB extends Schwifty.Model {
                static get [Schwifty.sandbox]() {

                    return 'plugin';
                }
            });

            plugin.registerModel(class ModelC extends Schwifty.Model {
                static get [Schwifty.sandbox]() {

                    return true;
                }
            });

            plugin.registerModel(class ModelD extends Schwifty.Model {
                static get [Schwifty.sandbox]() {

                    return false;
                }
            });

            plugin.registerModel(class ModelE extends Schwifty.Model {
                static get [Schwifty.sandbox]() {

                    return 'server';
                }
            });

            expect(server.models()).to.only.contain(['ModelA', 'ModelD', 'ModelE']);
            expect(plugin.models()).to.only.contain(['ModelA', 'ModelB', 'ModelC', 'ModelD', 'ModelE']);
        });

        it('throws on model name collision.', async () => {

            const server = await getServer();

            server.registerModel(TestModels.Dog);

            const plugin = {
                name: 'my-plugin',
                register: (srv) => {

                    srv.registerModel(TestModels.Dog);
                }
            };

            await expect(server.register(plugin)).to.reject('Model "Dog" has already been registered.');
        });

        it('throws when two sandboxed models with the same name are registered in the same namespace.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            const myPlugin = await getPlugin(server, 'my-plugin');

            myPlugin.registerModel(sandbox(TestModels.Dog));

            expect(() => {

                myPlugin.registerModel(sandbox(TestModels.Dog));
            }).to.throw('A model named "Dog" has already been registered in plugin namespace "my-plugin".');
        });

        it('throws when a non-sanboxed model shadows a sandboxed model of the same name.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            const myPlugin = await getPlugin(server, 'my-plugin');

            myPlugin.registerModel(sandbox(TestModels.Dog));

            const myOtherPlugin = await getPlugin(myPlugin, 'my-other-plugin');

            expect(() => {

                myOtherPlugin.registerModel(TestModels.Dog);
            }).to.throw('A model named "Dog" has already been registered in plugin namespace "my-plugin".');
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
                register: async (srv) => {

                    await srv.register({ plugin: Schwifty, options: { knex: knex2 } });

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

        it('returns knex instance associated with root namespace when passed true.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            const knex1 = makeKnex();
            const knex2 = makeKnex();

            await server.register({ plugin: Schwifty, options: { knex: knex1 } });

            const pluginA = await getPlugin(server, 'a');
            const pluginB = await getPlugin(pluginA, 'b');

            await pluginA.register({ plugin: Schwifty, options: { knex: knex2 } });

            expect(server.knex(true)).to.shallow.equal(server.knex());
            expect(pluginA.knex(true)).to.shallow.equal(server.knex());
            expect(pluginB.knex(true)).to.shallow.equal(server.knex());

            expect(server.knex()).to.shallow.equal(knex1);
            expect(pluginA.knex()).to.shallow.equal(knex2);
            expect(pluginB.knex()).to.shallow.equal(knex2);
        });

        it('returns knex instance associated with a plugin namespace when passed a string.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            const knex1 = makeKnex();
            const knex2 = makeKnex();
            const knex3 = Object.assign(makeKnex(), {
                [Schwifty.sandbox]: true
            });

            await server.register({ plugin: Schwifty, options: { knex: knex1 } });

            const pluginA = await getPlugin(server, 'a');
            const pluginB = await getPlugin(pluginA, 'b');
            const pluginC = await getPlugin(pluginB, 'c');

            await pluginC.register(Schwifty); // So that the namespace is known
            await pluginA.register({ plugin: Schwifty, options: { knex: knex2 } });
            await pluginB.register({ plugin: Schwifty, options: { knex: knex3 } });

            expect(server.knex('a')).to.shallow.equal(pluginA.knex());
            expect(server.knex('b')).to.shallow.equal(pluginB.knex());
            expect(server.knex('c')).to.shallow.equal(pluginC.knex());
            expect(pluginA.knex('b')).to.shallow.equal(pluginB.knex());
            expect(pluginA.knex('c')).to.shallow.equal(pluginC.knex());
            expect(pluginB.knex('a')).to.shallow.equal(pluginA.knex());
            expect(pluginB.knex('c')).to.shallow.equal(pluginC.knex());

            expect(server.knex()).to.shallow.equal(knex1);
            expect(pluginA.knex()).to.shallow.equal(knex2);
            expect(pluginB.knex()).to.shallow.equal(knex3);
            expect(pluginC.knex()).to.shallow.equal(knex2);
        });

        it('throws when accessing a namespace that doesn\'t exist.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            // This plugin namespace is unknown because it does not register schwifty or call server.registerModel()
            await getPlugin(server, 'nope');

            expect(() => server.knex('nope')).to.throw('The plugin namespace nope does not exist.');
        });

        it('throws when accessing a non-unique namespace.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            const pluginX1 = await getPlugin(server, 'x', { multiple: true });
            await pluginX1.register({ plugin: Schwifty, options: { knex: makeKnex() } });

            const pluginX2 = await getPlugin(server, 'x', { multiple: true });
            await pluginX2.register({ plugin: Schwifty, options: { knex: makeKnex() } });

            expect(() => server.models('x')).to.throw('The plugin namespace x is not unique: is that plugin registered multiple times?');
        });
    });

    describe('server initialization', () => {

        it('binds knex instances to models.', async () => {

            const knex = makeKnex();
            const server = await getServer({ knex });

            server.registerModel(TestModels.Person);

            const plugin = await getPlugin(server, 'plugin');
            plugin.registerModel(class Dog extends TestModels.Dog {
                static get [Schwifty.sandbox]() {

                    return true;
                }
            });

            expect(server.models().Person.knex()).to.not.exist();
            expect(plugin.models().Dog.knex()).to.not.exist();

            await server.initialize();

            expect(server.models().Person.knex()).to.shallow.equal(knex);
            expect(plugin.models().Dog.knex()).to.shallow.equal(knex);
        });

        it('does not bind knex instance to model when Schwifty.bindKnex property is false.', async () => {

            const knex = makeKnex();
            const server = await getServer({ knex });

            const plugin = await getPlugin(server, 'plugin');
            plugin.registerModel(TestModels.Person);
            plugin.registerModel(class Dog extends TestModels.Dog {
                static get [Schwifty.bindKnex]() {

                    return false;
                }
            });

            expect(server.models().Person.knex()).to.not.exist();
            expect(plugin.models().Dog.knex()).to.not.exist();

            await server.initialize();

            expect(server.models().Person.knex()).to.shallow.equal(knex);
            expect(plugin.models().Dog.knex()).to.not.exist();
        });

        it('binds root knex instance to plugins\' models by default.', async () => {

            const knex = makeKnex();
            const server = await getServer({ knex });

            const plugin = {
                name: 'plugin',
                register: (srv, opts) => {

                    srv.registerModel(TestModels.Person);
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
                register: async (srv) => {

                    await srv.register({ plugin: Schwifty, options: { knex: knex2 } });

                    srv.registerModel(TestModels.Person);
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

                    srv.registerModel(TestModels.Person);
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

            const server = await getServer({ knex: knex1 });
            server.registerModel(Person);

            expect(server.models().Person).to.shallow.equal(Person);
            expect(server.models().Person.knex()).to.shallow.equal(knex2);

            await server.initialize();

            expect(server.models().Person).to.shallow.equal(Person);
            expect(server.models().Person.knex()).to.shallow.equal(knex2);
        });

        describe('bails when a knex instance is not pingable', () => {

            const failKnexWith = (knex, error) => {

                knex.context.queryBuilder = () => ({
                    select: () => {

                        throw error;
                    }
                });

                return knex;
            };

            it('and lists associated models in error.', async () => {

                const knex = failKnexWith(makeKnex(), new Error());
                const server = await getServer({ knex });
                server.registerModel(TestModels.Dog);

                const pluginA = await getPlugin(server, 'a');
                const pluginB = await getPlugin(pluginA, 'b');

                pluginA.registerModel(TestModels.Person);
                pluginB.registerModel(sandbox(TestModels.Person));
                pluginB.registerModel(sandbox(TestModels.Zombie));

                await expect(server.initialize()).to.reject('Could not connect to database using schwifty knex instance for models: "Dog", "Person", "Person" (b), "Zombie" (b).');
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
                    register: async (srv) => {

                        await srv.register({ plugin: Schwifty, options: { knex } });
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

            const server = Hapi.server();

            server.path(`${__dirname}/migrations`);

            await server.register({
                plugin: Schwifty,
                options: {
                    knex: basicKnexConfig,
                    migrateOnStart: true,
                    migrationsDir: 'basic'
                }
            });

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
                register: async (server) => {

                    await server.register({
                        plugin: Schwifty,
                        options: { knex, migrationsDir }
                    });
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

            const server = await getServer(getOptions());

            server.registerModel(TestModels.Dog);
            server.registerModel(TestModels.Person);

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

                    srv.registerModel(TestModels.Movie);
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

            const server = await getServer(getOptions());

            server.registerModel(TestModels.Dog);
            server.registerModel(TestModels.Person);

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

                    srv.registerModel([TestModels.Zombie]);
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

        it('returns models associated with a plugin namespace when passed a string.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            const pluginA = await getPlugin(server, 'a');
            const pluginB = await getPlugin(pluginA, 'b');

            server.registerModel(TestModels.Dog);
            pluginA.registerModel(TestModels.Movie);
            pluginA.registerModel(sandbox(TestModels.Person));
            pluginB.registerModel(TestModels.Zombie);

            expect(server.models()).to.shallow.equal(pluginB.models(true));
            expect(server.models('a')).to.shallow.equal(pluginB.models('a'));
            expect(pluginA.models('b')).to.shallow.equal(pluginB.models());

            expect(server.models()).to.only.contain(['Dog', 'Movie', 'Zombie']);
            expect(pluginA.models()).to.only.contain(['Movie', 'Person', 'Zombie']);
            expect(pluginB.models()).to.only.contain(['Zombie']);
        });

        it('throws when accessing a namespace that doesn\'t exist.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            // This plugin namespace is unknown because it does not register schwifty or call server.registerModel()
            await getPlugin(server, 'nope');

            expect(() => server.models('nope')).to.throw('The plugin namespace nope does not exist.');
        });

        it('throws when accessing a non-unique namespace.', async () => {

            const server = Hapi.server();
            await server.register(Schwifty);

            const pluginX1 = await getPlugin(server, 'x', { multiple: true });
            pluginX1.registerModel(TestModels.Dog);

            const pluginX2 = await getPlugin(server, 'x', { multiple: true });
            pluginX2.registerModel(TestModels.Movie);

            expect(() => server.models('x')).to.throw('The plugin namespace x is not unique: is that plugin registered multiple times?');
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
                    static joiSchema = Joi.object({
                        persnicketyField: Joi.string().max(1).min(10)
                    }).options({
                        abortEarly: false
                    });
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

                    static joiSchema = Joi.object();

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
                expect(seenSchema).to.shallow.equal(Model.joiSchema);
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
                    static joiSchema = Joi.object({
                        requiredField: Joi.any().required(),
                        hasDefault: Joi.any().default('mosdef') // should not appear after validation
                    });
                };

                const instance = new Model();
                const missingField = {};

                expect(instance.$validate(missingField, { patch: true })).to.equal(missingField);
            });
        });

        describe('static getter joiSchemaPatch', () => {

            it('returns undefined for a missing Joi schema.', () => {

                expect(Schwifty.Model.joiSchemaPatch).to.equal(undefined);
            });

            it('memoizes the patch schema.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object();
                };

                expect(Model.joiSchemaPatch).to.exist();
                expect(Model.joiSchemaPatch).to.shallow.equal(Model.joiSchemaPatch);
            });

            it('forgets past memoization on extended classes.', () => {

                const ModelOne = class extends Schwifty.Model {
                    static joiSchema = Joi.object({ a: Joi.any() });
                };

                const keysOf = (schema) => Object.keys(schema.describe().keys || {});

                expect(keysOf(ModelOne.joiSchema)).to.only.include(['a']);
                expect(keysOf(ModelOne.joiSchemaPatch)).to.only.include(['a']);

                const ModelTwo = class extends ModelOne {
                    static joiSchema = ModelOne.joiSchema.keys({ b: Joi.any() });
                };

                expect(keysOf(ModelTwo.joiSchema)).to.only.include(['a', 'b']);
                expect(keysOf(ModelTwo.joiSchemaPatch)).to.only.include(['a', 'b']);
            });
        });

        describe('static setter joiSchemaPatch', () => {

            it('sets joiSchemaPatch.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({ a: Joi.any() });
                };

                const keysOf = (schema) => Object.keys(schema.describe().keys || {});

                expect(keysOf(Model.joiSchema)).to.only.include(['a']);
                expect(keysOf(Model.joiSchemaPatch)).to.only.include(['a']);

                const updatedPatch = Joi.object({ a: Joi.any(), b: Joi.any() });

                Model.joiSchemaPatch = updatedPatch;

                expect(Model.joiSchemaPatch).to.shallow.equal(updatedPatch);
                expect(keysOf(Model.joiSchemaPatch)).to.only.include(['a', 'b']);
            });
        });

        describe('static method field(name)', () => {

            it('tailors a patch version of the field validation by default.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        a: Joi.string().min(3),
                        b: Joi.string().default('b'),
                        c: Joi.string().required()
                    });
                };

                const a = Model.field('a');
                const b = Model.field('b');
                const c = Model.field('c');

                expect(a.validate('123')).to.equal({ value: '123' });
                expect(a.validate('12')).to.contain('error');

                expect(b.validate()).to.equal({ value: undefined });
                expect(b.validate('x')).to.equal({ value: 'x' });
                expect(b.validate(1)).to.contain('error');

                expect(c.validate()).to.equal({ value: undefined });
                expect(c.validate('x')).to.equal({ value: 'x' });
                expect(c.validate(1)).to.contain('error');
            });

            it('has a no-op "patch" schema alteration.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        a: Joi.string().min(3),
                        b: Joi.string().default('b'),
                        c: Joi.string().required()
                    });
                };

                const a = Model.field('a').tailor('patch');
                const b = Model.field('b').tailor('patch');
                const c = Model.field('c').tailor('patch');

                expect(a.validate('123')).to.equal({ value: '123' });
                expect(a.validate('12')).to.contain('error');

                expect(b.validate()).to.equal({ value: undefined });
                expect(b.validate('x')).to.equal({ value: 'x' });
                expect(b.validate(1)).to.contain('error');

                expect(c.validate()).to.equal({ value: undefined });
                expect(c.validate('x')).to.equal({ value: 'x' });
                expect(c.validate(1)).to.contain('error');
            });

            it('has a "full" schema alteration.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        a: Joi.string().min(3),
                        b: Joi.string().default('b'),
                        c: Joi.string().required()
                    });
                };

                const a = Model.field('a').tailor('full');
                const b = Model.field('b').tailor('full');
                const c = Model.field('c').tailor('full');

                expect(a.validate('123')).to.equal({ value: '123' });
                expect(a.validate('12')).to.contain('error');

                expect(b.validate()).to.equal({ value: 'b' });
                expect(b.validate('x')).to.equal({ value: 'x' });
                expect(b.validate(1)).to.contain('error');

                expect(c.validate()).to.contain('error');
                expect(c.validate('x')).to.equal({ value: 'x' });
                expect(c.validate(1)).to.contain('error');
            });

            it('supports nested properties.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        a: Joi.object({
                            d: Joi.string().min(3),
                            e: Joi.string().default('e')
                        }),
                        b: Joi.string().default('b'),
                        c: Joi.string().required()
                    });
                };

                const d = Model.field('a.d');
                const e = Model.field('a.e');

                const dfull = Model.field('a.d').tailor('full');
                const efull = Model.field('a.e').tailor('full');

                expect(d.validate('123')).to.equal({ value: '123' });
                expect(d.validate('12')).to.contain('error');

                expect(e.validate()).to.equal({ value: undefined });
                expect(e.validate('x')).to.equal({ value: 'x' });
                expect(e.validate(1)).to.contain('error');

                expect(dfull.validate('123')).to.equal({ value: '123' });
                expect(dfull.validate('12')).to.contain('error');

                expect(efull.validate()).to.equal({ value: 'e' });
                expect(efull.validate('x')).to.equal({ value: 'x' });
                expect(efull.validate(1)).to.contain('error');
            });

            it('validation throws when the schema contains an invalid ref.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        a: Joi.number(),
                        b: Joi.number(),
                        c: Joi.ref('a'),
                        d: Joi.expression('{b * a}')
                    });
                };

                const a = Model.field('a');
                const b = Model.field('b');
                const c = Model.field('c');
                const d = Model.field('d');

                expect(a.validate(5)).to.equal({ value: 5 });
                expect(b.validate(6)).to.equal({ value: 6 });
                expect(() => c.validate(5)).to.throw('Invalid reference exceeds the schema root: ref:a');
                expect(() => d.validate(30)).to.throw('Invalid reference exceeds the schema root: ref:b');

                const schema = Joi.object({
                    a: Joi.string(),
                    c
                });
                expect(schema.validate({ a: '123', c: '123' })).to.equal({ value: { a: '123', c: '123' } });
            });

            it('throws when field doesn\'t exist.', () => {

                const ModelOne = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        a: Joi.string().min(3),
                        b: Joi.string().default('b'),
                        c: Joi.string().required()
                    });
                };

                expect(() => ModelOne.field('a')).to.not.throw();
                expect(() => ModelOne.field('d')).to.throw('Schema does not contain path d');

                const ModelTwo = class extends Schwifty.Model {};

                expect(() => ModelTwo.field('a')).to.throw('Model does not have a joi schema.');
            });
        });

        describe('static getter jsonAttributes', () => {

            it('lists attributes that are specified as Joi objects or arrays.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        arr: Joi.array(),
                        obj: Joi.object(),
                        str: Joi.string(),
                        num: Joi.number()
                    });
                };

                const jsonAttributes = Model.jsonAttributes;

                expect(jsonAttributes.length).to.equal(2);
                expect(jsonAttributes).to.contain(['arr', 'obj']);
            });

            it('returns undefined for a missing Joi schema.', () => {

                expect(Schwifty.Model.jsonAttributes).to.equal(undefined);
            });

            it('returns an empty array for an empty Joi schema.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object();
                };

                expect(Model.jsonAttributes).to.equal([]);
            });

            it('is memoized.', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        arr: Joi.array(),
                        obj: Joi.object(),
                        str: Joi.string(),
                        num: Joi.number()
                    });
                };

                expect(Model.jsonAttributes).to.shallow.equal(Model.jsonAttributes);
            });

            it('if set, prefers set value.', () => {

                // Not affected by parent class

                const ParentModel = class extends Schwifty.Model {};
                ParentModel.jsonAttributes = false;

                const ModelOne = class extends ParentModel {
                    static joiSchema = Joi.object();
                };

                expect(ModelOne.jsonAttributes).to.equal([]);

                // Prefers own set value

                const ModelTwo = class extends Schwifty.Model {
                    static joiSchema = Joi.object();
                };

                ModelTwo.jsonAttributes = false;

                expect(ModelTwo.jsonAttributes).to.equal(false);
            });
        });

        describe('static setter jsonAttributes', () => {

            // A quick dip into unit (vs behavioral) testing!
            it('sets $$schwiftyJsonAttributes', () => {

                const Model = class extends Schwifty.Model {
                    static joiSchema = Joi.object({
                        arr: Joi.array(),
                        obj: Joi.object(),
                        str: Joi.string(),
                        num: Joi.number()
                    });
                };

                const jsonAttrs = Model.jsonAttributes;
                expect(jsonAttrs).to.equal(['arr', 'obj']);
                expect(jsonAttrs).to.shallow.equal(Model.$$schwiftyJsonAttributes);

                const emptyJsonAttrs = Model.jsonAttributes = [];
                expect(emptyJsonAttrs).to.shallow.equal(Model.$$schwiftyJsonAttributes);
                expect(Model.jsonAttributes).to.shallow.equal(emptyJsonAttrs);
            });
        });

        describe('static uniqueTag()', () => {

            it('has the default behavior for non-sandboxed models.', () => {

                const ModelA = class A extends Schwifty.Model {};
                ModelA.tableName = 'table_a';

                expect(ModelA.uniqueTag()).to.equal('table_a_A');

                const ModelB = class extends Schwifty.Model {
                    static get name() {
                        // In later node versions the class name can be inferred from the
                        // variable, so we actually have to go out of our way to have no name.
                        return null;
                    }
                };
                ModelB.tableName = 'table_b';

                expect(ModelB.uniqueTag()).to.equal('table_b');
            });

            it('is unique for sandboxed models.', () => {

                const ModelA1 = class A extends Schwifty.Model {};
                ModelA1[Schwifty.sandbox] = true;
                ModelA1.tableName = 'table_a';

                expect(ModelA1.uniqueTag()).to.equal(ModelA1.uniqueTag());
                expect(ModelA1.uniqueTag()).to.match(/^table_a_A_id:\d+$/);

                const ModelA2 = class A extends Schwifty.Model {};
                ModelA2[Schwifty.sandbox] = true;
                ModelA2.tableName = 'table_a';

                expect(ModelA2.uniqueTag()).to.equal(ModelA2.uniqueTag());
                expect(ModelA2.uniqueTag()).to.match(/^table_a_A_id:\d+$/);
                expect(ModelA2.uniqueTag()).to.not.equal(ModelA1.uniqueTag());

                const ModelA3 = class A extends ModelA2 {};

                expect(ModelA3.uniqueTag()).to.equal(ModelA3.uniqueTag());
                expect(ModelA3.uniqueTag()).to.match(/^table_a_A_id:\d+$/);
                expect(ModelA3.uniqueTag()).to.not.equal(ModelA1.uniqueTag());
                expect(ModelA3.uniqueTag()).to.not.equal(ModelA2.uniqueTag());

                const ModelB1 = class extends Schwifty.Model {
                    // In later node versions the class name can be inferred from the
                    // variable, so we actually have to go out of our way to have no name.
                    static get name() {

                        return null;
                    }
                };
                ModelB1[Schwifty.sandbox] = true;
                ModelB1.tableName = 'table_b';

                expect(ModelB1.uniqueTag()).to.equal(ModelB1.uniqueTag());
                expect(ModelB1.uniqueTag()).to.match(/^table_b_id:\d+$/);

                const ModelB2 = class extends Schwifty.Model {
                    static get name() {

                        return null;
                    }
                };
                ModelB2[Schwifty.sandbox] = true;
                ModelB2.tableName = 'table_b';

                expect(ModelB2.uniqueTag()).to.equal(ModelB2.uniqueTag());
                expect(ModelB2.uniqueTag()).to.match(/^table_b_id:\d+$/);
                expect(ModelB2.uniqueTag()).to.not.equal(ModelB1.uniqueTag());
            });

            it('is not unique for sandboxed models created from bindKnex() or bindTransaction().', () => {

                const ModelA = class A extends Schwifty.Model {};
                ModelA[Schwifty.sandbox] = true;
                ModelA.tableName = 'table_a';

                const ModelA1 = ModelA.bindKnex(makeKnex());
                const ModelA2 = ModelA1.bindKnex(makeKnex());
                const ModelA3 = ModelA.bindKnex(ModelA2.knex());

                expect(ModelA.uniqueTag()).to.equal(ModelA.uniqueTag());
                expect(ModelA1.uniqueTag()).to.equal(ModelA1.uniqueTag());
                expect(ModelA2.uniqueTag()).to.equal(ModelA2.uniqueTag());
                expect(ModelA3.uniqueTag()).to.equal(ModelA3.uniqueTag());

                expect(ModelA.uniqueTag()).to.match(/^table_a_A_id:\d+$/);
                expect(ModelA.uniqueTag()).to.equal(ModelA1.uniqueTag());
                expect(ModelA1.uniqueTag()).to.equal(ModelA2.uniqueTag());
                expect(ModelA2.uniqueTag()).to.equal(ModelA3.uniqueTag());

                const ModelB = class B extends Schwifty.Model {};
                ModelB[Schwifty.sandbox] = true;
                ModelB.tableName = 'table_b';

                const ModelB1 = ModelB.bindTransaction(makeKnex());
                const ModelB2 = ModelB1.bindTransaction(makeKnex());
                const ModelB3 = ModelB.bindTransaction(ModelB2.knex());

                expect(ModelB.uniqueTag()).to.equal(ModelB.uniqueTag());
                expect(ModelB1.uniqueTag()).to.equal(ModelB1.uniqueTag());
                expect(ModelB2.uniqueTag()).to.equal(ModelB2.uniqueTag());
                expect(ModelB3.uniqueTag()).to.equal(ModelB3.uniqueTag());

                expect(ModelB.uniqueTag()).to.match(/^table_b_B_id:\d+$/);
                expect(ModelB.uniqueTag()).to.equal(ModelB1.uniqueTag());
                expect(ModelB1.uniqueTag()).to.equal(ModelB2.uniqueTag());
                expect(ModelB2.uniqueTag()).to.equal(ModelB3.uniqueTag());
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

    describe('migrationsStubPath', () => {

        it('is the path of a hapi-friendly knex stub file.', async () => {

            const readFile = Util.promisify(Fs.readFile);

            const contents = (await readFile(Schwifty.migrationsStubPath)).toString();

            expect(contents).to.startWith('\'use strict\';');
            expect(contents).to.contain('exports.up = async (knex) => {');
            expect(contents).to.contain('exports.down = async (knex) => {');
        });
    });

    describe('ownership', () => {

        it('of models applies to server\'s realm and its ancestors while respecting sandboxing.', async () => {

            const makePlugin = (name, models, plugins) => ({
                name,
                async register(srv, options) {

                    await srv.register(plugins);
                    srv.registerModel(models);
                    srv.expose('models', () => srv.models());
                }
            });

            const ModelO = class ModelO extends Schwifty.Model {};
            // eslint-disable-next-line no-shadow
            const ModelOp = class ModelO extends Schwifty.Model {
                static get [Schwifty.sandbox]() {

                    return true;
                }
            };
            const ModelA1 = class ModelA1 extends Schwifty.Model {};
            const ModelA1a = class ModelA1a extends Schwifty.Model {};
            const ModelA1b = class ModelA1b extends Schwifty.Model {};
            const ModelA2 = class ModelA2 extends Schwifty.Model {};
            const ModelX1a = class ModelX1a extends Schwifty.Model {};

            const server = Hapi.server();
            await server.register(Schwifty);

            const pluginX1a = makePlugin('pluginX1a', [], []);
            const pluginX1 = makePlugin('pluginX1', [ModelOp, ModelX1a], [pluginX1a]);
            const pluginX = makePlugin('pluginX', [], [pluginX1]);
            const pluginA1 = makePlugin('pluginA1', [ModelA1a, ModelA1b], []);
            const pluginA = makePlugin('pluginA', [ModelA1, ModelA2], [pluginA1, pluginX]);

            server.registerModel(ModelO);

            await server.register(pluginA);

            const {
                pluginX1a: X1a,
                pluginX1: X1,
                pluginX: X,
                pluginA1: A1,
                pluginA: A
            } = server.plugins;

            const checkOwnership = () => {

                expect(X1a.models()).to.equal({});
                expect(X1.models()).to.only.contain([
                    'ModelO',
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
            };

            checkOwnership();

            await server.initialize();

            // Checking after initialization because models are re-assigned after binding knex
            checkOwnership();
        });

        it('of knex applies to server\'s realm and its children while respecting sandboxing.', async () => {

            const makePlugin = (name, models, knex, plugins) => ({
                name,
                async register(srv) {

                    await srv.register(plugins);

                    await srv.register({
                        plugin: Schwifty,
                        options: { knex }
                    });

                    srv.registerModel(models);

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
            const knex3 = makeKnex();
            knex3[Schwifty.sandbox] = true;

            const server = Hapi.server();
            await server.register(Schwifty);

            const pluginX1a = makePlugin('pluginX1a', [], undefined, []);
            const pluginX1 = makePlugin('pluginX1', [ModelX1a], knex3, [pluginX1a]);
            const pluginX = makePlugin('pluginX', [], knex1, [pluginX1]);
            const pluginA1 = makePlugin('pluginA1', [ModelA1a, ModelA1b], undefined, []);
            const pluginA = makePlugin('pluginA', [ModelA1, ModelA2], knex2, [pluginA1, pluginX]);

            server.registerModel(ModelO);

            await server.register(pluginA);

            const {
                pluginX1a: X1a,
                pluginX1: X1,
                pluginX: X,
                pluginA1: A1,
                pluginA: A
            } = server.plugins;

            expect(X1a.knex()).to.shallow.equal(knex1);
            expect(X1.knex()).to.shallow.equal(knex3);
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
            expect(BoundModelX1a.knex()).to.shallow.equal(knex3);
        });
    });
});
