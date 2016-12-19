'use strict';

const Joi = require('joi');

const internals = {};

internals.model = Joi.func();

exports.plugin = Joi.object({

    knexFile: Joi.object(),
    dir: Joi.string(), // dir for migrations folder
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ],
    defaults: Joi.object(),
    teardownOnStop: Joi.boolean()
});

exports.schwifty = Joi.array().items(internals.model).single();
