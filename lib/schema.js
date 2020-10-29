'use strict';

const Joi = require('joi');

exports.plugin = Joi.object({
    knex: [Joi.object(), Joi.func()], // Either a knex config (object) or a knex instance (func)
    migrationsDir: Joi.string(),
    teardownOnStop: Joi.boolean(),
    migrateOnStart: Joi.boolean().truthy('latest').allow('rollback')
});

exports.registerModel = Joi.array()
    .items(Joi.func().class())
    .single()
    .required();
