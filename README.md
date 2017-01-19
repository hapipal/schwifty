# schwifty

A [hapi](https://github.com/hapijs/hapi) plugin integrating [Objection ORM](http://vincit.github.io/objection.js)

[![Build Status](https://travis-ci.org/BigRoomStudios/schwifty.svg?branch=master)](https://travis-ci.org/BigRoomStudios/schwifty) [![Coverage Status](https://coveralls.io/repos/github/BigRoomStudios/schwifty/badge.svg?branch=master)](https://coveralls.io/github/BigRoomStudios/schwifty?branch=master) [![Security Status](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2/badge)](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2)


## Usage
Schwifty is used to define [Joi](https://github.com/hapijs/joi)-compatible models and knex connections for use with Objection ORM.  Those models then become available within your hapi server where it is most convenient.  It has been tailored to multi-plugin deployments, where each plugin may set clear boundaries in defining its own models, knex database connections, and migrations.  It's safe to register schwifty multiple times, wherever you'd like to use it, as it protects against model name collisions and other ambiguous configurations.

```js
// First, ensure your project includes your
// preferred versions of knex and objection!

const Hapi = require('hapi');
const Joi = require('joi');
const Schwifty = require('schwifty');

const server = new Hapi.Server();
server.connection({ port: 3000 });

server.route({
    method: 'get',
    path: '/dogs/{name}',
    handler: function (request, reply) {

        const Dogs = request.models().Dogs;
        const name = request.params.name;

        reply(Dogs.query().where({ name }));
    }
});

server.register({
    register: Schwifty,
    options: {
        knex: {
            client: 'sqlite3',
            connection: {
                filename: ':memory:'
            }
        }
    }
}, (err) => {

    if (err) {
        throw err;
    }

    // Register a model with schwifty
    server.schwifty(
        class Dog extends Schwifty.Model {
            static get tableName() {

                return 'Dog';
            }

            static get joiSchema() {

                return Joi.object({
                    name: Joi.string(),
                });
            }
        }
    );

    server.start((err) => {

        if (err) {
            throw err;
        }

        // Add some records

        const Dogs = server.models().Dogs;

        Promise.all([
            Dogs.query().insert({ name: 'Guinness' }),
            Dogs.query().insert({ name: 'Sully' }),
            Dogs.query().insert({ name: 'Ren' })
        ])
        .then(() => {

            console.log(`Go find some dogs at ${server.info.uri}`);
        })
        .catch((err) => {

            console.error(err);
        });
    });
});
```

## Extras
 - [SOON] Compatible with [haute-couture](https://github.com/devinivy/haute-couture)
 - [Objection docs](http://vincit.github.io/objection.js)
 - [Knex docs](http://knexjs.org/)
 - Based on [dogwater](https://github.com/devinivy/dogwater)
