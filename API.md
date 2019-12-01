# API
## The hapi plugin
### Registration
Schwifty may be registered multiple times—it should be registered in any plugin that would like to use any of its features.  Upon each registration these options are collected until server initialization.  Models and knex configurations passed during configuration are attributed to the registering plugin/server under schwifty's [ownership system](#plugin-ownership-of-knex-instances-and-models). The model(s) `name` must be unique across the entire server.  Server initialization will fail if any knex instances handled by schwifty do not have basic database connectivity.

Schwifty takes the following registration options,

  - `knex` - a knex instance or [configuration](https://knexjs.org/#Installation-client).  It may only be specified once per plugin/server.
  - `models` - an array of objection or [schwifty model classes](#schwiftymodel).  May also be a path to a module that exports such an array—either absolute, relative to the server's [path prefix](https://hapi.dev/api/#server.path()) when set, or otherwise relative to the current working directory.
  - `migrationsDir` - specifies a directory of knex migrations.  The directory path may be either absolute, relative to the server's [path prefix](https://hapi.dev/api/#server.path()) when set, or otherwise relative to the current working directory.  It may only be specified once per plugin/server.
  - `migrateOnStart` - a boolean, `'latest'`, or `'rollback'`, to determine how to handle [knex migrations](https://knexjs.org/#Migrations) at server initialization time.  Defaults to `false`, which indicates to not handle migrations at all.  When `true` or `'latest'`, runs all migrations that have not been run.  When `'rollback'`, rolls-back the latest group of migrations.  It may only be specified once.
  - `teardownOnStop` - a boolean indicating whether or not all knex connections should be torn-down when the hapi server stops (after server connections are drained).  Defaults to `true`, and may only be specified once.


### Server decorations
#### `server.schwifty(config)`
Used to declare models, knex instances, and migration directory information on a per-plugin basis or on the root server.  In other words, these settings are particular to the current plugin under schwifty's [ownership system](#plugin-ownership-of-knex-instances-and-models).  The `config` may be either,

  - An objection or [schwifty model class](#schwiftymodel), or an array of such model classes associated with the current plugin or root server.
  - An object specifying,
    - `knex` - a knex instance or [configuration](https://knexjs.org/#Installation-client) associated with the current plugin or root server.  It may only be specified once per plugin/server.
    - `models` - An array of objection or [schwifty model classes](#schwiftymodel) associated with the current plugin or root server.
    - `migrationsDir` - specifies a directory of knex migrations associated with the current plugin or root server.  The directory path may be either absolute, relative to the plugin's [path prefix](https://hapi.dev/api/#server.path()) when set, or otherwise relative to the current working directory.  It cannot be specified more than once within a plugin or on the root server.

#### `server.knex()`
Returns `server`'s knex instance under schwifty's [plugin ownership of knex instances](#knex-instances).

#### `server.models([all])`
Returns an object containing models keyed by their `name`.  Includes `server`'s models based upon schwifty's [plugin ownership of models](#models).  When `all` is `true`, models across the entire server are returned.

### Request decorations
#### `request.knex()`
Returns knex instance under schwifty's [plugin ownership of knex instances](#knex-instances), where the active plugin is the one in which the `request`'s route was declared (i.e. based upon `request.route.realm`).


#### `request.models([all])`
Returns an object containing models keyed by their `name`.  Includes models based upon schwifty's [plugin ownership of models](#models), where the active plugin is the one in which the `request`'s route was declared (i.e. based upon `request.route.realm`).  When `all` is `true`, models across the entire server are returned.


### Response toolkit decorations
#### `h.knex()`
Returns knex instance under schwifty's [plugin ownership of knex instances](#knex-instances), where the active plugin is the one in which the corresponding route or server extension was declared (i.e. based upon `h.realm`).

#### `h.models([all])`
Returns an object containing models keyed by their `name`.  Includes models based upon schwifty's [plugin ownership of models](#models), where the active plugin is the one in which the corresponding route or server extension was declared (i.e. based upon `h.realm`).  When `all` is `true`, models across the entire server are returned.


### Plugin ownership of knex instances and models
> How do plugins "own" knex instances and models?

Schwifty cares a whole lot about plugin boundaries.  Plugins represent the structure of your application, and we think that's not only practical but also very meaningful.  Under schwifty plugins declare knex instances and models, and actually retain _ownership_ of them in a useful way that respects your application's plugin boundaries.

#### Knex instances
Whenever a plugin or the root server configures a knex instance, either by [registering](#registration) schwifty and passing `knex` or calling [`server.schwifty({ knex })`](#serverschwiftyconfig), an instance of knex is attributed to that plugin.  Consider `plugin-x` that declares a knex instance.  It becomes available by calling [`server.knex()`](#serverknex) within `plugin-x`, or [`request.knex()`](#requestknex) within one of `plugin-x`'s routes.  But it goes further!  This instance of knex is also available to all plugins _registered by_ `plugin-x` that do not have their own knex instances.

This allows us to handle very common use-cases, e.g. a single knex/database is configured on the root server: all other plugins using schwifty are registered under the root server and automatically inherit that database configuration.  But it also allows us to handle complex cases, e.g. multiple applications with their own knex/databases all being deployed together as separate plugins on a single hapi server.

#### Models
Whenever a plugin or the root server declares some models, either by [registering](#registration) schwifty and passing `models` or calling [`server.schwifty(models)`](#serverschwiftyconfig), those models are attributed to that plugin.  Consider `plugin-x` registering plugin `plugin-a`, which declares the model `Pets`.  Inside `plugin-a` the `Pets` model is available by calling [`server.models()`](#servermodelsall) within `plugin-a`, or [`request.models()`](#requestmodelsall) within one of `plugin-a`'s routes.  But, just as with [knex instances](#knex-instances), it goes further!  `Pets` is also available to `plugin-x` since it registered `plugin-a`.  In fact, `Pets` is available to the entire plugin chain up to the root server.  In this way, the root server will have access to every model declared by any plugin.

This allows us to handle very common use-cases, e.g. a plugin simply wants to declare and use some models.  But it also allows us to handle complex cases, e.g. authoring a plugin that declares some models that you would like to reuse across multiple applications.

Note that the [schmervice](https://github.com/hapipal/schmervice) plugin deals with plugin ownership of services in exactly the same way.

> As an escape hatch, you can always call [`server.models(true)`](#servermodelsall) (passing `true` to any of the server, request, or response toolkit's `models()` decoration) to break the plugin boundary and access any model declared by any plugin on the entire server.

#### An example
Consider two plugins, `plugin-a` and `plugin-b`,

- the root server registers `plugin-a`.
- `plugin-a` registers `plugin-b`.
- `plugin-a` declares the model `Dogs` and a knex instance using `server.schwifty({ models, knex })`.
- `plugin-b` declares the model `Zombies` using `server.schwifty(models)` and does not declare a knex instance.

Then we can say the following,

- The root server will have access to both `Dogs` and `Zombies` models, having inherited both of them from its "children" plugins.
- The root server has no knex instance of its own.
- `plugin-a` will have access to both `Dogs` and `Zombies` models, having inherited `Zombies` from `plugin-b`.
- `plugin-b` will have access to only the `Zombies` model.
- Both `Dogs` and `Zombies` models will be bound to `plugin-a`'s knex instance. `Zombies` is bound to that instance because `plugin-b` inherits its knex instance from its nearest "ancestor" with a knex instance, `plugin-a`.


### What happens during server initialization?
Schwifty performs a few important routines during server initialization.

#### Binding models to knex
First, models are bound to instances of knex on a per-plugin basis.  Each model is bound to the knex instance of the plugin—under [plugin ownership of knex instances](#knex-instances)—in which the model was defined.  If a model already is bound to a knex instance prior to initialization, it will not be bound to a new one.

This means that prior to server initialization, calls to [`server.models()`](#servermodelsall) will provide models that will not be bound to a knex instance (unless you've done so manually).  If you would like to perform some tasks during server initialization that rely on database-connected models, simply tell your `onPreStart` server extension to occur after schwifty, e.g.,
```js
server.ext('onPreStart', someDbConnectedTask, { after: 'schwifty' });
```

You could also do this by treating schwifty as a plugin dependency,
```js
server.dependency('schwifty', someDbConnectedTask);
```

#### Database connectivity
Second, every knex instance declared during [plugin registration](#registration) or with [`server.schwifty({ knex })`](#serverschwiftyconfig) is checked for connectivity.  If any instance of knex does not have database connectivity, you will receive an error and your server will not initialize.  While this does not make any guarantees about table existence or structure, it does guarantee database connectivity at server initialization time.

#### Migrations
Lastly, if you specified `migrateOnStart` as `true`, `'latest'`, or `'rollback'`, then migrations will be run against each knex instance.  Your instance of knex may specify its own [knex migration options](https://knexjs.org/#Migrations-API), except for `directory`, which will be ignored in favor of the migration directories declared using the `migrationsDir` option with [`server.schwifty()`](#serverschwiftyconfig).

If a knex instance is shared across plugins (under [plugin ownership of knex instances](#knex-instances)) and each plugin specifies its own migrations directory using `migrationsDir`, then migrations from each of those plugin's migrations directories will simply be run against the knex instance.  In short, schwifty pluginizes knex migrations.

The `migrateOnStart` options `true` and `'latest'` correspond to [`knex.migrate.latest()`](https://knexjs.org/#Migrations-latest), while `'rollback'` corresponds to [`knex.migrate.rollback()`](https://knexjs.org/#Migrations-rollback).

## `Schwifty.Model`
Schwifty's model class extends [`Objection.Model`](https://vincit.github.io/objection.js/api/model/), adding support for [Joi](https://github.com/hapijs/joi) schemas wherever objection's base model class employs [`jsonSchema`](https://vincit.github.io/objection.js/api/model/static-properties.html#static-jsonschema).  This primarily plays into model instance validation and serialization of JSON/array fields.

### `joiSchema`
An optional [`Joi.object()`](https://hapi.dev/family/joi/#object) schema, where each of its keys is a field of the given model.

### `jsonAttributes`
This property is computed as a getter using the contents of `joiSchema`.  Any of the schema's keys that are [`Joi.object()`](https://hapi.dev/family/joi/#object)s or [`Joi.array()`](https://hapi.dev/family/joi/#array)s will be included in the list of JSON attributes.  If this property is set, it will forget about having been computed.  For more info, see objection's [`jsonAttributes`](https://vincit.github.io/objection.js/api/model/static-properties.html#static-jsonattributess).

### `getJoiSchema([patch])`
Returns the [`joiSchema`](#joischema) and memoizes the result.  This is useful when `joiSchema` is defined as a getter, but you'd like to avoid constantly recompiling the schema when accessing it.  Past memoization is forgotten by extended classes.  When `patch` is `true`, the same schema is returned (and memoized separately), but set so that it ignores default values and missing required fields.

### `model.$validate()`
Validates the model instance using its [`joiSchema`](#joischema).  This is implemented using objection's [`Validator`](https://vincit.github.io/objection.js/api/types/#class-validator) interface.

## Utilities
### `Schwifty.assertCompatible(ModelA, ModelB, [message])`
Ensures that `ModelA` and `ModelB` have the same class `name`, share the same `tableName`, and that one model extends the other, otherwise throws an error.  When `message` is provided, it will be used as the message for any thrown error.
