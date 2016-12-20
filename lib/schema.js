'use strict';

const Joi = require('joi');

const internals = {};

// internals.model = Joi.func().keys({
//     tableName: Joi.string().required()
// }).unknown();
internals.model = Joi.func();

exports.plugin = Joi.object({

    knexFile: Joi.object(),
    dir: Joi.string(), // dir for migrations folder
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ],
    teardownOnStop: Joi.boolean()
});

exports.schwifty = Joi.array().items(internals.model).single();
