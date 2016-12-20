'use strict';

const Joi = require('joi');

const internals = {};

// internals.model = Joi.func().keys({
//     tableName: Joi.string().required()
// }).unknown();
internals.model = Joi.func();

exports.plugin = Joi.object({

    knexFile: Joi.object(),
    migration: Joi.object({
        dir: Joi.string(),
        mode: Joi.string()
    }).optional(),
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ],
    teardownOnStop: Joi.boolean()
});

exports.schwifty = Joi.alternatives([
    Joi.array().items(internals.model).single(),
    Joi.object({ // It's a knexFile plus any models passed in
        test: Joi.object(),
        development: Joi.object(),
        staging: Joi.object(),
        production: Joi.object(),
        models: Joi.array().items(internals.model).single()
    })
]);
