# API
## The hapi plugin
### Registration
Schwifty may be registered multiple times– it should be registered in any plugin that would like to use any of its features.  It's suggested that registration options only be passed when schwifty is registered outside of a plugin (on the root server), and that within plugins [`server.schwifty()`](#serverschwiftyconfig) be used instead, at least for defining models.  Upon each registration these options are collected until server initialization.  Model `name`s must be unique across the entire server.  Server initialization will fail if any knex instances handled by schwifty do not have basic database connectivity.

Schwifty takes the following registration options,

  - `knex` - a knex instance or configuration.  This will determine the server-wide default knex instance; if a plugin does not declare its own knex instance using [`server.schwifty()`](#serverschwiftyconfig) then this one will be used.  It cannot be specified more than once for the root server.
  - `models` - An array of objection or [schwifty model classes](#schwiftymodel) associated with the root server.
  - `migrationsDir` - specifies a directory of knex migrations associated with the root server.  The directory path may be either absolute or relative to the current working directory.  It cannot be specified more than once for the root server.
  - `migrateOnStart` - a boolean, `'latest'`, or `'rollback'`, to determine how to handle [knex migrations](http://knexjs.org/#Migrations) at server initialization time.  Defaults to `false`, which indicates to not handle migrations at all.  When `true` or `'latest'`, runs all migrations that have not been run.  When `'rollback'`, rolls-back the latest group of migrations.
  - `teardownOnStop` - a boolean indicating whether or not all knex connections should be torn-down when the hapi server stops (after server connections are drained).  Defaults to `true`, and may only be specified once.


### Server decorations
#### `server.knex()`
Returns the knex instance used by the current plugin. In other words, this returns the knex instance for the active realm, falling back to the root server's server-wide default knex instance.

#### `server.models([all])`


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

### Migrations

## `Schwifty.Model`
