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
    }),
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ],
    teardownOnStop: Joi.boolean()
});

exports.schwifty = Joi.array().items(internals.model).single();
