# schwifty

A model layer for [hapi](https://hapi.dev) integrating [Objection ORM](https://vincit.github.io/objection.js/)

[![Build Status](https://travis-ci.org/hapipal/schwifty.svg?branch=master)](https://travis-ci.org/hapipal/schwifty) [![Coverage Status](https://coveralls.io/repos/github/hapipal/schwifty/badge.svg?branch=master)](https://coveralls.io/github/hapipal/schwifty?branch=master)

Lead Maintainer - [Devin Ivy](https://github.com/devinivy)

## Installation
```sh
npm install @hapipal/schwifty
```

## Usage
> See also the [API Reference](API.md)
>
> Schwifty is intended for use with hapi v19+, joi v17+, Objection v1 and v2, knex v0.16+, and nodejs v12+ (_see v5 for lower support_)

Schwifty is used to define [joi](https://github.com/sideway/joi)-compatible models and knex connections for use with Objection ORM.  Those models then become available within your hapi server where it is most convenient.  It has been tailored to multi-plugin deployments, where each plugin may set clear boundaries in defining its own models, knex database connections, and migrations.  It's safe to register schwifty multiple times, wherever you'd like to use it, as it protects against model name collisions and other ambiguous configurations.

```js
// First, ensure your project includes knex, objection, and sqlite3

// To get started you might run,
// npm install --save @hapipal/schwifty @hapi/hapi joi knex objection sqlite3

'use strict';

const Hapi = require('@hapi/hapi');
const Schwifty = require('@hapipal/schwifty');
const Joi = require('joi');

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

    server.registerModel(
        class Dog extends Schwifty.Model {
            static tableName = 'Dog';
            static joiSchema = Joi.object({
                id: Joi.number(),
                name: Joi.string()
            });
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

    console.log(`Now, go find some dogs at ${server.info.uri}`);
})();
```

## Extras
 - Compatible with [haute-couture](https://github.com/hapipal/haute-couture)
 - [Objection docs](http://vincit.github.io/objection.js/)
 - [Knex docs](https://knexjs.org/)
