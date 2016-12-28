'use strict';

const Joi = require('joi');

const internals = {};

// internals.model = Joi.func().keys({
//     tableName: Joi.string().required()
// }).unknown();
internals.model = Joi.func();

exports.plugin = Joi.object({
    knexConfig: Joi.object(),
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ],
    teardownOnStop: Joi.boolean()
});

exports.schwifty = Joi.alternatives([
    Joi.array().items(internals.model).single(),
    Joi.object({
        knexConfig: Joi.object()
    }).unknown() /*
        The knexConfig relevant to environment. Not going to lock this schema down
        because Knex can be responsible for that part
    */
]);
