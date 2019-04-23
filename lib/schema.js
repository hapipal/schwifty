'use strict';

const Joi = require('@hapi/joi');

const internals = {};

internals.model = Joi.func().class();

internals.configBase = Joi.object({
    knex: [Joi.object(), Joi.func()], // Either a knex config (object) or a knex instance (func)
    migrationsDir: Joi.string()
});

exports.plugin = internals.configBase.keys({
    teardownOnStop: Joi.boolean(),
    migrateOnStart: Joi.boolean().truthy('latest').allow('rollback'),
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ]
});

exports.schwifty = Joi.alternatives([
    Joi.array().items(internals.model).single(),
    internals.configBase.keys({
        models: Joi.array().items(internals.model)
    })
]);
