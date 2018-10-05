# schwifty

A [hapi](https://github.com/hapijs/hapi) plugin integrating [Objection ORM](https://github.com/Vincit/objection.js)

[![Build Status](https://travis-ci.org/hapipal/schwifty.svg?branch=master)](https://travis-ci.org/hapipal/schwifty) [![Coverage Status](https://coveralls.io/repos/github/hapipal/schwifty/badge.svg?branch=master)](https://coveralls.io/github/hapipal/schwifty?branch=master) [![Security Status](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2/badge)](https://nodesecurity.io/orgs/schwifty/projects/43d64006-d2bd-41c7-a288-5ae051d0e3c2)

Lead Maintainer - [Devin Ivy](https://github.com/devinivy)

<details>
  <summary>
    <img src='https://imgur.com/SZIjzOW.png' width=50> <b>Boilerplate Integration</b>
  </summary>
<p>
<br>
This module is specialized to work with the <a href='https://github.com/hapipal/boilerplate'>hapipal boilerplate</a>

#### Boilerplate setup

```sh
# Clone new hapipal project
npx hpal new my-project
cd ./my-project
npm install

# Make your first commit to init project history
git add --all
git commit -m "Init commit"
```
Now we're ready to add the `Objection ORM` flavor

```sh
git fetch pal --tags
git cherry-pick objection
npm install
```
#### Flavor Results
`git status` should show
```sh
Changes to be committed:

  new file:   knexfile.js
  new file:   lib/migrations/.gitkeep
  new file:   lib/models/.gitkeep
  new file:   lib/plugins/schwifty.js
  modified:   package.json
  modified:   server/manifest.js

Unmerged paths:
  (use "git add/rm <file>..." as appropriate to mark resolution)

  deleted by them: package-lock.json
```

#### Usage setup
```sh
hpal make model Dog
# Wrote lib/models/Dog.js
hpal make route dogs
# Wrote lib/routes/dogs.js
```
Time to write a migration file – more about `knex` migration files [here]()
```sh
knex migrate:make dogs
# Created Migration: path/to/my-project/lib/migrations/20181004162336_dogs.js
```

Edit that file

```js
exports.up = function(knex, Promise) {

    return knex.schema.createTable('Dog', (table) => {

        table.increments('id').primary();
        table.string('name');
    })
    .then(() => {

        // This part is for demo purposes only, you should use knex seeds to
        // put model fixtures in your project if you want the db to have any
        return Promise.all([
            knex('Dog').insert({ name: 'Guinness' }),
            knex('Dog').insert({ name: 'Sully' }),
            knex('Dog').insert({ name: 'Ren' })
        ]);
    });
};

exports.down = function(knex, Promise) {

    return knex.schema.dropTable('Dog');
};
```

Schwifty's defaults will ensure this migration is run when you start the server via `migrateOnStart: true`

#### Fill in details

Fill in the details of `lib/models/Dog` and `lib/routes/dogs` based on the `Usage` section below

**NOTE** It's important to change the class name of your model to `Dog`, or
whatever matches your tableName

#### Dog catcher
Use hpal to catch some dogs
```sh
hpal run debug:curl /dogs/1
# Dog { id: 1, name: 'Guinness' }

hpal run debug:curl /dogs/2
# Dog { id: 2, name: 'Sully' }

hpal run debug:curl /dogs/3
# Dog { id: 3, name: 'Ren' }
```
</p>
</details>

## Usage
> See also the [API Reference](API.md)

Schwifty is used to define [Joi](https://github.com/hapijs/joi)-compatible models and knex connections for use with Objection ORM.  Those models then become available within your hapi server where it is most convenient.  It has been tailored to multi-plugin deployments, where each plugin may set clear boundaries in defining its own models, knex database connections, and migrations.  It's safe to register schwifty multiple times, wherever you'd like to use it, as it protects against model name collisions and other ambiguous configurations.

> Note, this library is intended to work with **hapi v17+** and **Objection v1** (see `peerDependencies` in our package.json).
>
> Schwifty v4 introduced compatibility with Objection v1.  If you prefer or need to work with earlier versions of Objection, checkout Schwifty v3 instead!

```js
// First, ensure your project includes knex, objection, and sqlite3

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
 - Compatible with [haute-couture](https://github.com/hapipal/haute-couture)
 - [Objection docs](http://vincit.github.io/objection.js)
 - [Knex docs](http://knexjs.org/)
 - Based on [dogwater](https://github.com/devinivy/dogwater)
