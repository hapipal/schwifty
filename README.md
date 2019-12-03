# schwifty

A [hapi](https://hapi.dev) plugin integrating [Objection ORM](https://vincit.github.io/objection.js/)

[![Build Status](https://travis-ci.org/hapipal/schwifty.svg?branch=master)](https://travis-ci.org/hapipal/schwifty) [![Coverage Status](https://coveralls.io/repos/github/hapipal/schwifty/badge.svg?branch=master)](https://coveralls.io/github/hapipal/schwifty?branch=master)

Lead Maintainer - [Devin Ivy](https://github.com/devinivy)

## Usage
> See also the [API Reference](API.md)

Schwifty is used to define [Joi](https://github.com/hapijs/joi)-compatible models and knex connections for use with Objection ORM.  Those models then become available within your hapi server where it is most convenient.  It has been tailored to multi-plugin deployments, where each plugin may set clear boundaries in defining its own models, knex database connections, and migrations.  It's safe to register schwifty multiple times, wherever you'd like to use it, as it protects against model name collisions and other ambiguous configurations.

> **Note**
>
> Schwifty is intended for use with hapi v17+, joi v14 and v15, Objection v1 and v2, knex v0.8+, and nodejs v8+.
>
> Schwifty v4 introduced compatibility with Objection v1.  If you prefer or need to work with earlier versions of Objection, checkout Schwifty v3 instead!

```js
// First, ensure your project includes knex, objection, and sqlite3

// To get started you might run,
// npm install --save schwifty @hapi/hapi @hapi/joi@15 knex objection sqlite3

'use strict';

const Hapi = require('@hapi/hapi');
const Joi = require('@hapi/joi');
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
 - Compatible with [haute-couture](https://github.com/hapipal/haute-couture)
 - [Objection docs](http://vincit.github.io/objection.js/)
 - [Knex docs](https://knexjs.org/)
 - Based on [dogwater](https://github.com/devinivy/dogwater)
