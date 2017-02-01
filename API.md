# API
## The hapi plugin
### Registration
Schwifty may be registered multiple times– it should be registered in any plugin that would like to use any of its features.  It's suggested that registration options only be passed when schwifty is registered outside of a plugin (on the root server), and that within plugins [`server.schwifty()`](#serverschwiftyconfig) be used instead, at least for defining models.  Upon each registration these options are collected until server initialization.  Model `name`s must be unique across the entire server.  Server initialization will fail if any knex instances handled by schwifty do not have basic database connectivity.

Schwifty takes the following registration options,

  - `knex` - a knex instance or [configuration](http://knexjs.org/#Installation-client).  This will determine the server-wide default knex instance; if a plugin does not declare its own knex instance using [`server.schwifty()`](#serverschwiftyconfig) then this one will be used.  It cannot be specified more than once for the root server.
  - `models` - An array of objection or [schwifty model classes](#schwiftymodel) associated with the root server.
  - `migrationsDir` - specifies a directory of knex migrations associated with the root server.  The directory path may be either absolute or relative to the current working directory.  It cannot be specified more than once for the root server.
  - `migrateOnStart` - a boolean, `'latest'`, or `'rollback'`, to determine how to handle [knex migrations](http://knexjs.org/#Migrations) at server initialization time.  Defaults to `false`, which indicates to not handle migrations at all.  When `true` or `'latest'`, runs all migrations that have not been run.  When `'rollback'`, rolls-back the latest group of migrations.
  - `teardownOnStop` - a boolean indicating whether or not all knex connections should be torn-down when the hapi server stops (after server connections are drained).  Defaults to `true`, and may only be specified once.


### Server decorations
#### `server.knex()`
Returns the knex instance used by the current plugin. In other words, this returns the knex instance for the active realm, falling back to the root server's server-wide default knex instance.

#### `server.models([all])`
Returns an object containing models keyed by `name`.  When `all` is `true`, models across the entire server are returned.  Otherwise, only models declared within the current plugin (or, active realm) are returned.

#### `server.schwifty(config)`
Used to register models, knex instances, and migration directory information on a per-plugin basis or on the root server.  In other words, these settings are particular to the active [realm](https://github.com/hapijs/hapi/blob/master/API.md#serverrealm).  The `config` may be either,

  - An objection or [schwifty model class](#schwiftymodel), or an array of such model classes associated with the current plugin or root server.
  - An object specifying,
    - `knex` - a knex instance or configuration.  This will determine the knex instance that should be used within the current plugin.  If it's specified on the root server, it will set the server-wide default knex instance.  It cannot be specified more than once within a plugin or on the root server, but the same knex instance may be shared by multiple plugins.
    - `models` - An array of objection or [schwifty model classes](#schwiftymodel) associated with the current plugin or root server.
    - `migrationsDir` - specifies a directory of knex migrations associated with the current plugin or root server.  The directory path may be either absolute or relative to the current working directory.  It cannot be specified more than once within a plugin or on the root server.


### Request decorations
#### `request.knex()`
Returns the knex instance used by `request.route`'s plugin. In other words, this returns the knex instance for `request.route`'s active realm, falling back to the root server's server-wide default knex instance.

#### `request.models([all])`
Returns an object containing models keyed by `name`.  When `all` is `true`, models across the entire server are returned.  Otherwise, only models declared within `request.route`'s plugin (or, active realm) are returned.

### What happens during server initialization?
Schwifty performs a few important routines during server initialization.

#### Binding models to knex
First, each model is bound to its plugin's or active realm's knex instance (falling back to the server-wide default knex instance).  If a model already is bound to a knex instance, it will not be bound to a new one.  This means that prior to server initialization, calls to [`server.models()`](#servermodelsall) will provide models that will not be bound to a knex instance (unless you've done so manually).  If you would like to perform some tasks during server initialization that rely on database-connected models, simply tell your `onPreStart` server extension to occur after schwifty, e.g.,
```js
server.ext('onPreStart', someDbConnectedTask, { after: 'schwifty' });
```

You could also do this by treating schwifty as a plugin dependency,
```js
server.dependency('schwifty', someDbConnectedTask);
```

#### Database connectivity
Second, every knex instance declared during [plugin registration](#registration) or with [`server.schwifty()`](#serverschwiftyconfig) is checked for connectivity.  If any instance of knex does not have database connectivity, you will receive an error and your server will not initialize.  While this does not make any guarantees about table existence or structure, it does guarantee database connectivity at server initialization time.

#### Migrations
Lastly, if you specified `migrateOnStart` as `true`, `'latest'`, or `'rollback'`, then migrations will be run against each knex instance.  Your instance of knex may specify its own [knex migration options](http://knexjs.org/#Migrations-API), except for `directory`, which will be ignored in favor of the migration directories declared using the `migrationsDir` option with [`server.schwifty()`](#serverschwiftyconfig).

If a knex instance is shared across plugins and each plugin specifies its own migrations directory using `migrationsDir`, then migrations from each of those plugin's migrations directories will simply be run against the knex instance.  In short, schwifty pluginizes knex migrations.

The `migrateOnStart` options `true` and `'latest'` correspond to [`knex.migrate.latest()`](http://knexjs.org/#Migrations-latest), while `'rollback'` corresponds to [`knex.migrate.rollback()`](http://knexjs.org/#Migrations-rollback).

## `Schwifty.Model`
Schwifty's model class extends [`Objection.Model`](http://vincit.github.io/objection.js/#model), adding support for [Joi](https://github.com/hapijs/joi) schemas wherever objection's base model class employs [`jsonSchema`](http://vincit.github.io/objection.js/#jsonschema).  This primarily plays into model instance validation and serialization of JSON/array fields.

### `joiSchema`
An optional [`Joi.object()`](https://github.com/hapijs/joi/blob/master/API.md#object) schema, where each of its keys is a field of the given model.

### `jsonAttributes`
This property is computed as a getter using the contents of `joiSchema`.  Any of the schema's keys that are [`Joi.object()`](https://github.com/hapijs/joi/blob/master/API.md#object)s or [`Joi.array()`](https://github.com/hapijs/joi/blob/master/API.md#array)s will be included in the list of JSON attributes.  If this property is set, it will forget about having been computed.  For more info, see objection's [`jsonAttributes`](http://vincit.github.io/objection.js/#jsonattributes).

### `getJoiSchema([patch])`
Returns the [`joiSchema`](#joischema) and memoizes the result.  This is useful when `joiSchema` is defined as a getter, but you'd like to avoid constantly recompiling the schema when accessing it.  Past memoization is forgotten by extended classes.  When `patch` is `true`, the same schema is returned (and memoized separately), but set so that it ignores default values and missing required fields.

### `parseJoiValidationError(joiValidation)`
Extracts the details of a Joi error for use as the contents of an objection [`ValidationError`](http://vincit.github.io/objection.js/#validationerror).

### `model.$validate()`
Validates the model instance using the its [`joiSchema`](#joischema), falling back to objection's base implementation of [`$validate()`](http://vincit.github.io/objection.js/#_s_validate).
