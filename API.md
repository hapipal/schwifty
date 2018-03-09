# API
## The hapi plugin
### Registration
Schwifty may be registered multiple times—it should be registered in any plugin that would like to use any of its features.  Upon each registration these options are collected until server initialization.  Models and knex configurations passed during configuration are attributed to the registering plugin/server under schwifty's [ownership model]().  Model `name`s must be unique across the entire server.  Server initialization will fail if any knex instances handled by schwifty do not have basic database connectivity.

Schwifty takes the following registration options,

  - `knex` - a knex instance or [configuration](http://knexjs.org/#Installation-client).  It may only be specified once per plugin/server.
  - `models` - An array of objection or [schwifty model classes](#schwiftymodel).  May also be a path to a module that exports such an array– either absolute, relative to the server's [path prefix](https://github.com/hapijs/hapi/blob/master/API.md#server.path()) when set, or otherwise relative to the current working directory.
  - `migrationsDir` - specifies a directory of knex migrations.  The directory path may be either absolute, relative to the server's [path prefix](https://github.com/hapijs/hapi/blob/master/API.md#server.path()) when set, or otherwise relative to the current working directory.  It may only be specified once per plugin/server.
  - `migrateOnStart` - a boolean, `'latest'`, or `'rollback'`, to determine how to handle [knex migrations](http://knexjs.org/#Migrations) at server initialization time.  Defaults to `false`, which indicates to not handle migrations at all.  When `true` or `'latest'`, runs all migrations that have not been run.  When `'rollback'`, rolls-back the latest group of migrations.  It may only be specified once.
  - `teardownOnStop` - a boolean indicating whether or not all knex connections should be torn-down when the hapi server stops (after server connections are drained).  Defaults to `true`, and may only be specified once.


### Server decorations
#### `server.knex()`
Returns the knex instance used by the current plugin. In other words, this returns the knex instance for the active realm. If none exists, the first knex instance encountered on climbing up through the current plugin's ancestors until reaching the root server's knex instance is returned.

#### `server.models([all])`
Returns an object containing models keyed by `name`.  When `all` is `true`, models across the entire server are returned.  Otherwise, only models declared within a.) the current plugin (or, server's active realm) and b.) all children plugins of the current plugin (e.g. if the current plugin has registered a plugin that registers models, the current plugin would have access to the models registered by its child plugin) are returned.


#### `server.schwifty(config)`
Used to register models, knex instances, and migration directory information on a per-plugin basis or on the root server.  In other words, these settings are particular to the active [realm](https://github.com/hapijs/hapi/blob/master/API.md#server.realm).  The `config` may be either,

  - An objection or [schwifty model class](#schwiftymodel), or an array of such model classes associated with the current plugin or root server.
  - An object specifying,
    - `knex` - a knex instance or configuration.  This will determine the knex instance that should be used within the current plugin.  If it's specified on the root server, it will set the server-wide default knex instance.  It cannot be specified more than once within a plugin or on the root server, but the same knex instance may be shared by multiple plugins.
        - For example, any plugin that doesn't have its own knex instance can use the root server's. Note the root server isn't special here, just is the top link in our plugin ancestry. If a plugin isn't bound to a knex instance, it just reaches up this ancestry until it finds one, stopping when it reaches the end of our "family tree". This end just happens to be the current root server of your application, but would change, for example, if your application became a plugin of a different server, which would become the new root server, offering a new possible knex instance if this new server also registered schwifty
    - `models` - An array of objection or [schwifty model classes](#schwiftymodel) associated with the current plugin or root server.
    - `migrationsDir` - specifies a directory of knex migrations associated with the current plugin or root server.  The directory path may be either absolute, relative to the plugin's [path prefix](https://github.com/hapijs/hapi/blob/master/API.md#server.path()) when set, or otherwise relative to the current working directory.  It cannot be specified more than once within a plugin or on the root server.


### Request decorations
#### `request.knex()`
Returns the knex instance used by `request.route`'s plugin. In other words, this returns the knex instance for `request.route`'s active realm. If none exists, the first knex instance encountered as you climb up through `request.route`'s ancestors until reaching the root server's knex instance is returned.

#### `request.models([all])`
Returns an object containing models keyed by `name`.  When `all` is `true`, models across the entire server are returned. Otherwise, only models declared within a.) `request.route`'s plugin (or, active realm) and b.) all children plugins of the `request.route`'s plugin (e.g. if `request.route`'s plugin has registered a plugin that registers models, `request.route`'s plugin would have access to the models registered by its child plugin) are returned.

### Response toolkit decorations
#### `h.knex()`
Returns the knex instance used by the current route's plugin. In other words, this returns the knex instance for the active realm as identified by `h.realm`. If none exists, the first knex instance encountered on climbing up through the current route's plugin's ancestors until reaching the root server's knex instance is returned.

#### `h.models([all])`
Returns an object containing models keyed by `name`.  When `all` is `true`, models across the entire server are returned. Otherwise, only models declared within a.) the current route's plugin (or, active realm, as identified by `h.realm`) and b.) all children plugins of the current route's plugin (e.g. if the current route's plugin has registered a plugin that registers models, the current route's plugin would have access to the models registered by its child plugin) are returned.

### The ownership model
> How do plugins "own" knex instances and models?

Schwifty cares a whole lot about plugin boundaries.  Plugins represent the structure of your application, and we think that's not only useful but also very meaningful.  Under schwifty plugins declare knex instances and models, and actually retain _ownership_ of them in a useful way that respects your application's plugin boundaries.

#### Knex instances
Whenever a plugin or the root server configures a knex instance, either by [registering](#registration) schwifty and passing `knex` or calling [`server.schwifty({ knex })`](#serverschwiftyconfig), an instance of knex is attributed to that plugin.  Consider `plugin-x` that declares a knex instance.  It becomes available by calling `server.knex()` within `plugin-x`, or `request.knex()` within one `plugin-x`'s routes.  But it goes further!  This instance of knex is also available to all plugins _registered by_ `plugin-x` that do not have their own knex instances.

This allows us to handle very common use-cases, e.g. a single knex/database is configured on the root server: all other plugins using schwifty are registered under the root server and automatically inherit that database configuration.  But it also allows us to handle complex cases, e.g. multiple applications with their own knex/databases all being deployed together as separate plugins on a single hapi server.

#### Models


### What happens during server initialization?
Schwifty performs a few important routines during server initialization.

#### Binding models to knex
First, each model is bound to its plugin's or active realm's knex instance.  If no knex instance is bound to the active realm, then the plugin's ancestry is indeterminately searched for one, binding the first knex instance found to the plugin's models.

For example, take 2 plugins: `pluginA` and `pluginB`:

- `pluginA` registers `pluginB`
- `pluginA` registers the model `Dogs` and binds a knex instance
- `pluginB` registers the model `Zombies` and does not bind a knex instance

On server initialization,

- `pluginA` will have access to both `Dogs` and `Zombies` (via the `models` decorations described above), as parents have access to their own and their children's models.
- `pluginB` will have acccess to only `Zombies`
- All models will be bound to `pluginA`'s knex instance. `Zombies` is bound to that instance because `pluginB` attempts to bind its own knex instance to `Zombies`, but finds that none was configured, so it then searches through its ancestors. It checks its parent first, immediately finding a knex instance, so binds that.

In short, models and knex instances pass through our plugin architecture as follows:

- Models propagate upwards; as child plugins register their own models, their parents "know" about more models
- Knex instances propagate downwards; a child plugin will "adopt" a knex instance from up the ancestral chain if it doesn't own one

If a model already is bound to a knex instance, it will not be bound to a new one.  This means that prior to server initialization, calls to [`server.models()`](#servermodelsall) will provide models that will not be bound to a knex instance (unless you've done so manually).  If you would like to perform some tasks during server initialization that rely on database-connected models, simply tell your `onPreStart` server extension to occur after schwifty, e.g.,
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
An optional [`Joi.object()`](https://github.com/hapijs/joi/blob/master/API.md#object---inherits-from-any) schema, where each of its keys is a field of the given model.

### `jsonAttributes`
This property is computed as a getter using the contents of `joiSchema`.  Any of the schema's keys that are [`Joi.object()`](https://github.com/hapijs/joi/blob/master/API.md#object---inherits-from-any)s or [`Joi.array()`](https://github.com/hapijs/joi/blob/master/API.md#array---inherits-from-any)s will be included in the list of JSON attributes.  If this property is set, it will forget about having been computed.  For more info, see objection's [`jsonAttributes`](http://vincit.github.io/objection.js/#jsonattributes).

### `getJoiSchema([patch])`
Returns the [`joiSchema`](#joischema) and memoizes the result.  This is useful when `joiSchema` is defined as a getter, but you'd like to avoid constantly recompiling the schema when accessing it.  Past memoization is forgotten by extended classes.  When `patch` is `true`, the same schema is returned (and memoized separately), but set so that it ignores default values and missing required fields.

### `model.$validate()`
Validates the model instance using its [`joiSchema`](#joischema).  This is implemented using objection's [`Validator`](http://vincit.github.io/objection.js/#validator) interface.

## Utilities
### `Schwifty.assertCompatible(ModelA, ModelB, [message])`
Ensures that `ModelA` and `ModelB` have the same class `name`, share the same `tableName`, and that one model extends the other, otherwise throws an error.  When `message` is provided, it will be used as the message for any thrown error.
