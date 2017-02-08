# schwifty

A [hapi](https://github.com/hapijs/hapi) plugin integrating [Objection ORM](https://github.com/Vincit/objection.js)

[![Build Status](https://travis-ci.org/BigRoomStudios/schwifty.svg?branch=master)](https://travis-ci.org/BigRoomStudios/schwifty) [![Coverage Status](https://coveralls.io/repos/github/BigRoomStudios/schwifty/badge.svg?branch=master)](https://coveralls.io/github/BigRoomStudios/schwifty?branch=master) [![Security Status](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2/badge)](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2)


## Usage
> See also the [API Reference](API.md)

Schwifty is used to define [Joi](https://github.com/hapijs/joi)-compatible models and knex connections for use with Objection ORM.  Those models then become available within your hapi server where it is most convenient.  It has been tailored to multi-plugin deployments, where each plugin may set clear boundaries in defining its own models, knex database connections, and migrations.  It's safe to register schwifty multiple times, wherever you'd like to use it, as it protects against model name collisions and other ambiguous configurations.

```js
// First, ensure your project includes your
// preferred versions of knex, objection, and sqlite3

// To get started you might run,
// npm install --save hapi joi schwifty knex objection sqlite3

'use strict';

const Hapi = require('hapi');
const Joi = require('joi');
const Schwifty = require('schwifty');

const server = new Hapi.Server();
server.connection({ port: 3000 });

server.route({
    method: 'get',
    path: '/dogs/{id}',
    handler: function (request, reply) {

        const Dog = request.models().Dog;

        reply(Dog.query().findById(request.params.id));
    }
});

server.register({
    register: Schwifty,
    options: {
        knex: {
            client: 'sqlite3',
            useNullAsDefault: true,
            connection: {
                filename: ':memory:'
            }
        }
    }
})
.then(() => {

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

    // ... then initialize the server, connecting your models to knex...
    return server.initialize();
})
.then(() => {
    // ... then make a table ...

    const knex = server.knex();

    return knex.schema.createTable('Dog', (table) => {

        table.increments('id').primary();
        table.string('name');
    });
})
.then(() => {
    // ... then add some records ...

    const Dog = server.models().Dog;

    return Promise.all([
        Dog.query().insert({ name: 'Guinness' }),
        Dog.query().insert({ name: 'Sully' }),
        Dog.query().insert({ name: 'Ren' })
    ]);
})
.then(() => {
    // ... then start the server!

    return server.start();
})
.then(() => {

    console.log(`Now, go find some dogs at ${server.info.uri}!`);
})
.catch((err) => {

    console.error(err);
    process.exit(1);
});
```

## Extras
 - Compatible with [haute-couture](https://github.com/devinivy/haute-couture)
 - [Objection docs](http://vincit.github.io/objection.js)
 - [Knex docs](http://knexjs.org/)
 - Based on [dogwater](https://github.com/devinivy/dogwater)
