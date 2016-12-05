'use strict';

const Joi = require('joi');

const internals = {};

internals.model = Joi.func();

exports.plugin = Joi.object({
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ],
    defaults: Joi.object(),
    teardownOnStop: Joi.boolean()
});

exports.schwifty = Joi.array().items(internals.model).single();
