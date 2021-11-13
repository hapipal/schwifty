# API

A model layer for [hapi](https://hapi.dev) integrating [Objection ORM](https://vincit.github.io/objection.js/)

> **Note**
>
> Schwifty is intended for use with hapi v19+, nodejs v12+, Joi v17+, Objection v1 through v3, and knex v0.16+ (_see v5 for lower support_).

## The hapi plugin
### Registration
Schwifty may be registered multiple times—it should be registered in any plugin that would like to use any of its features.  Upon each registration these options are collected until server initialization.  Knex configurations passed during registration are attributed to the registering plugin/server under schwifty's [ownership system](#plugin-ownership-of-knex-instances-and-models).  Server initialization will fail if any knex instances handled by schwifty do not have basic database connectivity.

Schwifty takes the following registration options,

  - `knex` - a knex instance or [configuration](https://knexjs.org/#Installation-client).  It may only be specified once per plugin/server.
  - `migrationsDir` - specifies a directory of knex migrations.  The directory path may be either absolute, relative to the server's [path prefix](https://hapi.dev/api/#server.path()) when set, or otherwise relative to the current working directory.  It may only be specified once per plugin/server.
  - `migrateOnStart` - a boolean, `'latest'`, or `'rollback'`, to determine how to handle [knex migrations](https://knexjs.org/#Migrations) at server initialization time.  Defaults to `false`, which indicates to not handle migrations at all.  When `true` or `'latest'`, runs all migrations that have not been run.  When `'rollback'`, rolls-back the latest group of migrations.  It may only be specified once.
  - `teardownOnStop` - a boolean indicating whether or not all knex connections should be torn-down when the hapi server stops (after server connections are drained).  Defaults to `true`, and may only be specified once.


### Server decorations
#### `server.registerModel(models)`
Used to declare models on a per-plugin basis or on the root server.  In other words, these models are particular to the current plugin under schwifty's [ownership system](#plugin-ownership-of-knex-instances-and-models).

The `models` should be an objection or [schwifty model class](#schwiftymodel), or an array of such model classes to be associated with the current plugin or root server.  Note that this method protects from model `name` conflicts across the server.

#### `server.knex([namespace])`
Returns `server`'s knex instance.

Per schwifty's [plugin ownership of knex instances](#knex-instances), this is the knex instance provided by `server` or the nearest knex instance among `server`'s ancestors (e.g. if `server` is within a plugin that has been registered by a separate plugin that provides a knex instance) that is also not [sandboxed](#sandboxing).

By passing a `namespace` you can obtain knex instance from the perspective of a different plugin. When `namespace` is a string, you receive the knex instance that is visibile within the plugin named `namespace`. And when `namespace` is `true`, you receive the knex instance that is visible to the root server.

#### `server.models([namespace])`
Returns an object containing models keyed by their `name`.

Per schwifty's [plugin ownership of models](#models), the models that are available on this object are only those registered by `server` or any plugins for which `server` is an ancestor (e.g. if `server` has registered a plugin that registers models) that are also not [sandboxed](#sandboxing).

By passing a `namespace` you can obtain the models from the perspective of a different plugin. When `namespace` is a string, you receive models that are visibile within the plugin named `namespace`. And when `namespace` is `true`, you receive models that are visible to the root server: every model registered with the hapi server– across all plugins– that isn't sandboxed.

### Request decorations
#### `request.knex([namespace])`
Returns a knex instance.  See [`server.knex()`](#serverknexnamespace), where `server` is the one in which the `request`'s route was declared (i.e. based upon `request.route.realm`).

#### `request.models([all])`
Returns an object containing models keyed by their `name`.  See [`server.models()`](#servermodelsnamespace), where `server` is the one in which the `request`'s route was declared (i.e. based upon `request.route.realm`).

### Response toolkit decorations
#### `h.knex([namespace])`
Returns a knex instance.  See [`server.knex()`](#serverknexnamespace), where `server` is the one in which the corresponding route or server extension was declared (i.e. based upon `h.realm`).

#### `h.models([namespace])`
Returns an object containing models keyed by their `name`.  See [`server.models()`](#servermodelsnamespace), where `server` is the one in which the corresponding route or server extension was declared (i.e. based upon `h.realm`).


### Plugin ownership of knex instances and models
> How do plugins "own" knex instances and models?

Schwifty cares a whole lot about plugin boundaries.  Plugins represent the structure of your application, and we think that's not only practical but also very meaningful.  Under schwifty plugins declare knex instances and models, and actually retain _ownership_ of them in a useful way that respects your application's plugin boundaries.

#### Knex instances
Whenever a plugin or the root server configures a knex instance by [registering](#registration) schwifty and passing `knex`, an instance of knex is attributed to that plugin.  Consider `plugin-x` that declares a knex instance.  It becomes available by calling [`server.knex()`](#serverknexnamespace) within `plugin-x`, or [`request.knex()`](#requestknexnamespace) within one of `plugin-x`'s routes.  But it goes further!  This instance of knex is also available to all plugins _registered by_ `plugin-x` that do not have their own knex instances.

This allows us to handle very common use-cases, e.g. a single knex/database is configured on the root server: all other plugins using schwifty are registered under the root server and automatically inherit that database configuration.  But it also allows us to handle complex cases, e.g. multiple applications with their own knex/databases all being deployed together as separate plugins on a single hapi server.

#### Models
Whenever a plugin or the root server declares some models by calling [`server.registerModel()`](#serverregistermodelmodels), those models are attributed to that plugin.  Consider `plugin-x` registering plugin `plugin-a`, which declares the model `Pets`.  Inside `plugin-a` the `Pets` model is available by calling [`server.models()`](#servermodelsnamespace) within `plugin-a`, or [`request.models()`](#requestmodelsnamespace) within one of `plugin-a`'s routes.  But, just as with [knex instances](#knex-instances), it goes further!  `Pets` is also available to `plugin-x` since it registered `plugin-a`.  In fact, `Pets` is available to the entire plugin chain up to the root server.  In this way, the root server will have access to every model declared by any plugin (barring [sandboxing](#sandboxing)).

This allows us to handle very common use-cases, e.g. a plugin simply wants to declare and use some models.  But it also allows us to handle complex cases, e.g. authoring a plugin that declares some models that you would like to reuse across multiple applications.

Note that the [schmervice](https://github.com/hapipal/schmervice) plugin deals with plugin ownership of services in exactly the same way.

> As an escape hatch, you can always call [`server.models(true)`](#servermodelsnamespace) (passing `true` to any of the server, request, or response toolkit's `models()` decoration) to break the plugin boundary and access models declared by any plugin on the entire server.  You may similarly pass a plugin name in order to access models from the perspective of that specific plugin, e.g. `server.models('my-plugin')`.

#### Sandboxing
When a model or knex instance is "sandboxed", it is only visible within the plugin that directly provides it.  This is a form of opting-out of transitive ownership of models and knex instances described in the previous two sections.  However, sandboxed models and knex instances can still be accessed from other plugins using the `namespace` parameter as described in [`server.models([namespace])`](#servermodelsnamespace) and [`server.knex([namespace])`](#serverknexnamespace)

In order to sandbox a model, set the [`Schwifty.sandbox`](#schwiftysandbox) property to `true` on it statically (you may also use a getter):

```js
class User extends Schwifty.Model {
    static tableName = 'Users';
    static [Schwifty.sandbox] = true;
};
```

Similarly, in order to sandbox a knex instance, set its [`Schwifty.sandbox`](#schwiftysandbox) property to `true`:

```js
const knex = Knex({ client: 'sqlite3' });
knex[Schwifty.sandbox] = true;
```

> In order to make ensure that this property doesn't conflict with Objection or Knex internals, `Schwifty.sandbox` is a symbol.

#### An example
Consider two plugins, `plugin-a` and `plugin-b`,

- the root server registers `plugin-a`.
- `plugin-a` registers `plugin-b`.
- `plugin-a` declares a knex instance by registering schwifty and the model `Dogs` using `server.registerModel()`.
- `plugin-b` declares the model `Zombies` using `server.registerModel()` and does not declare a knex instance.

Then we can say the following,

- The root server will have access to both `Dogs` and `Zombies` models, having inherited both of them from its "children" plugins.
- The root server has no knex instance of its own.
- `plugin-a` will have access to both `Dogs` and `Zombies` models, having inherited `Zombies` from `plugin-b`.
- `plugin-b` will have access to only the `Zombies` model.
- Both `Dogs` and `Zombies` models will be bound to `plugin-a`'s knex instance. `Zombies` is bound to that instance because `plugin-b` inherits its knex instance from its nearest "ancestor" with a knex instance, `plugin-a`.


### What happens during server initialization?
Schwifty performs a few important routines during server initialization.

#### Binding models to knex
First, models are bound to instances of knex on a per-plugin basis.  Each model is bound to the knex instance of the plugin—under [plugin ownership of knex instances](#knex-instances)—in which the model was defined.  If a model already is bound to a knex instance prior to initialization, it will not be bound to a new one.  Additionally, if a model's [`Schwifty.bindKnex`](#schwiftybindknex) property is `false` then it will not be bound.

This means that prior to server initialization, calls to [`server.models()`](#servermodelsnamespace) will provide models that will not be bound to a knex instance (unless you've done so manually).  If you would like to perform some tasks during server initialization that rely on database-connected models, simply tell your `onPreStart` server extension to occur after schwifty, e.g.,
```js
server.ext('onPreStart', someDbConnectedTask, { after: 'schwifty' });
```

You could also do this by treating schwifty as a plugin dependency,
```js
server.dependency('schwifty', someDbConnectedTask);
```

#### Database connectivity
Second, every knex instance declared during [plugin registration](#registration) is checked for connectivity.  If any instance of knex does not have database connectivity, you will receive an error and your server will not initialize.  While this does not make any guarantees about table existence or structure, it does guarantee database connectivity at server initialization time.

#### Migrations
Lastly, if you specified `migrateOnStart` as `true`, `'latest'`, or `'rollback'`, then migrations will be run against each knex instance.  Your instance of knex may specify its own [knex migration options](https://knexjs.org/#Migrations-API), except for `directory`, which will be ignored in favor of the migration directories declared using the `migrationsDir` [plugin registration](#registration) option.

If a knex instance is shared across plugins (under [plugin ownership of knex instances](#knex-instances)) and each plugin specifies its own migrations directory using `migrationsDir`, then migrations from each of those plugin's migrations directories will simply be run against the knex instance.  In short, schwifty pluginizes knex migrations.

The `migrateOnStart` options `true` and `'latest'` correspond to [`knex.migrate.latest()`](https://knexjs.org/#Migrations-latest), while `'rollback'` corresponds to [`knex.migrate.rollback()`](https://knexjs.org/#Migrations-rollback).

## `Schwifty.Model`
Schwifty's model class extends [`Objection.Model`](https://vincit.github.io/objection.js/api/model/), adding support for [Joi](https://joi.dev/) schemas wherever objection's base model class employs [`jsonSchema`](https://vincit.github.io/objection.js/api/model/static-properties.html#static-jsonschema).  This primarily plays into model instance validation and serialization of JSON/array fields.

### `joiSchema`
An optional [`Joi.object()`](https://joi.dev/api/#object) schema, where each of its keys is a field of the given model.

### `joiSchemaPatch`
This property is computed as a getter using the contents of `joiSchema`.  It is identical to `joiSchema`, except it ignores default values and missing required fields.  Objection additionally validates `Model.query().patch()` query input against this schema.

### `jsonAttributes`
This property is computed as a getter using the contents of `joiSchema`.  Any of the schema's keys that are [`Joi.object()`](https://joi.dev/api/#object)s or [`Joi.array()`](https://joi.dev/api/#array)s will be included in the list of JSON attributes.  If this property is set, it will forget about having been computed.  For more info, see objection's [`jsonAttributes`](https://vincit.github.io/objection.js/api/model/static-properties.html#static-jsonattributes).

### `field(name)`
Returns the schema for the field named `name` on the model's [`joiSchema`](#joischema), but marked as optional and ignoring defaults.  The schema also has two [alterations](https://joi.dev/api/#anyaltertargets): one named `'full'` which respects defaults and required/optional/forbidden status, and another named `'patch'` which does nothing but exists to allow for explicitness.

```js
const User = class User extends Schwifty.Model {
    static joiSchema = Joi.object({
        username: Joi.string().min(4).required()
    });
};

// no alteration
User.field('username').validate();        // { value: undefined }
User.field('username').validate('pal');   // { error }, as username must be at least 4 characters
User.field('username').validate('paldo'); // { value: 'paldo' }

// "patch" alteration: identical to the above
User.field('username').tailor('patch').validate();
User.field('username').tailor('patch').validate('pal');
User.field('username').tailor('patch').validate('paldo');

// "full" alteration
User.field('username').tailor('full').validate();         // { error }, as username is required
User.field('username').tailor('full').validate('pal');    // { error }, as username must be at least 4 characters
User.field('username').tailor('full').validate('paldo');  // { value: 'paldo' }
```

### `model.$validate()`
Validates the model instance using its [`joiSchema`](#joischema).  This is implemented using objection's [`Validator`](https://vincit.github.io/objection.js/api/types/#class-validator) interface.

## Utilities and Symbols

### `Schwifty.assertCompatible(ModelA, ModelB, [message])`
Ensures that `ModelA` and `ModelB` have the same class `name`, share the same `tableName`, and that one model extends the other, otherwise throws an error.  When `message` is provided, it will be used as the message for any thrown error.

### `Schwifty.migrationsStubPath`
A path to a knex migrations stub file that utilizes async/await and is set to follow the hapi style guide.  This is intended to be used with [knexfile](https://knexjs.org/#knexfile) configurations (as of knex v0.18.4) and the [`knex migrate:make`](https://knexjs.org/#Migrations-CLI) command:

```js
// knexfile.js
const Schwifty = require('@hapipal/schwifty');

module.exports = {
    client: 'pg',
    migrations: {
        stub: Schwifty.migrationsStubPath
    }
};
```

### `Schwifty.sandbox`

A symbol that may be added as a property to a knex instance or a model in order to participate in [sandboxing](#sandboxing).

Sandboxing ensures that the object in question opts out of transitive ownership as described in ["Plugin ownership of knex instances and models"](#plugin-ownership-of-knex-instances-and-models), and in turn is only visible within the plugin where it is provided.

When this property is set to `true` or `'plugin'` the object will be sandboxed. The default behavior of plugin ownership can be explicitly configured using the value `false` or `'server'`.

### `Schwifty.bindKnex`

A symbol that may be added as a property to a model in order to opt-out of [knex-binding during server initialization](#binding-models-to-knex).  When this property is set to `false`, a knex instance will not automatically be bound to the model.
