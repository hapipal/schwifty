# schwifty

A [hapi](https://github.com/hapijs/hapi) plugin integrating [Objection ORM](https://github.com/Vincit/objection.js)

[![Build Status](https://travis-ci.org/BigRoomStudios/schwifty.svg?branch=master)](https://travis-ci.org/BigRoomStudios/schwifty) [![Coverage Status](https://coveralls.io/repos/github/BigRoomStudios/schwifty/badge.svg?branch=master)](https://coveralls.io/github/BigRoomStudios/schwifty?branch=master) [![Security Status](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2/badge)](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2)


## Usage
> See also the [API Reference](API.md)

Schwifty is used to define [Joi](https://github.com/hapijs/joi)-compatible models and knex connections for use with Objection ORM.  Those models then become available within your hapi server where it is most convenient.  It has been tailored to multi-plugin deployments, where each plugin may set clear boundaries in defining its own models, knex database connections, and migrations.  It's safe to register schwifty multiple times, wherever you'd like to use it, as it protects against model name collisions and other ambiguous configurations.

```js
// First, ensure your project includes knex, objection, and sqlite3
// Note that for knex and Objection, we assume using
// knex >=0.8 and Objection >=1 <2 (see our peerDependencies in our package file)
// Schwifty v4 introduced compatibility with Objection v1
// If you prefer / need to work with earlier versions of Objection, checkout Schwifty v3 instead!

// To get started you might run,
// npm install --save hapi joi schwifty knex objection sqlite3

'use strict';

const Hapi = require('hapi');
const Joi = require('joi');
const Schwifty = require('schwifty');

(async () => {

    const server = Hapi.server({ port: 3000 });

    server.route({
        method: 'get',
        path: '/dogs/{id}',
        handler: async (request) => {

            const { Dog } = request.models();

            return await Dog.query().findById(request.params.id);
        }
    });

    await server.register({
        plugin: Schwifty,
        options: {
            knex: {
                client: 'sqlite3',
                useNullAsDefault: true,
                connection: {
                    filename: ':memory:'
                }
            }
        }
    });

    // Register a model with schwifty...

    server.schwifty(
        class Dog extends Schwifty.Model {
            static get tableName() {

                return 'Dog';
            }

            static get joiSchema() {

                return Joi.object({
                    id: Joi.number(),
                    name: Joi.string()
                });
            }
        }
    );

    await server.initialize();

    // ... then make a table ...

    const knex = server.knex();

    await knex.schema.createTable('Dog', (table) => {

        table.increments('id').primary();
        table.string('name');
    });

    // ... then add some records ...

    const { Dog } = server.models();

    await Promise.all([
        Dog.query().insert({ name: 'Guinness' }),
        Dog.query().insert({ name: 'Sully' }),
        Dog.query().insert({ name: 'Ren' })
    ]);

    // ... then start the server!

    await server.start();

    console.log(`Now, go find some dogs at ${server.info.uri}!`);
})();
```

## Extras
 - Compatible with [haute-couture](https://github.com/devinivy/haute-couture)
 - [Objection docs](http://vincit.github.io/objection.js)
 - [Knex docs](http://knexjs.org/)
 - Based on [dogwater](https://github.com/devinivy/dogwater)
