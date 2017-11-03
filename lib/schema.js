'use strict';

const Joi = require('joi');

const internals = {};

internals.model = Joi.func(); // Really, a class

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
    // .single() converts a single model definition to an array containing that model
    // allowing a single model to fit with the array-to-config coercion in index::internals.schwifty
    Joi.array().items(internals.model).single(),
    internals.configBase.keys({
        models: Joi.array().items(internals.model)
    })
]);
