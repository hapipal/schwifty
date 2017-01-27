# API
## The hapi plugin
### Registration
Schwifty may be registered multiple times– it should be registered in any plugin that would like to use any of its features.  It's suggested that registration options only be passed when schwifty is registered outside of a plugin (on the root server), and that within plugins [`server.schwifty()`](#serverschwiftyconfig) be used instead, at least for defining models.  Upon each registration these options are collected until server initialization.  The same model may not be specified more than once. Schwifty takes the following registration options,

  - `knex` - x.
  - `models` - x.
  - `migrationsDir` - x.
  - `migrateOnStart` - x.
  - `teardownOnStop` - a boolean indicating whether or not all knex connections should be torn-down when the hapi server stops (after server connections are drained).  Defaults to `true`, and may only be specified once.


### Server decorations
#### `server.knex()`
#### `server.models([all])`
#### `server.schwifty(config)`
Registers additional xxxxxx.  The `config` may be either,

  - A model class or an array of model classes.
  - An object specifying,
    - `knex` - x.
    - `models` - x.
    - `migrationsDir` - x.


### Request decorations
#### `request.knex()`
#### `request.models([all])`

### Migrations

## `Schwifty.Model`
