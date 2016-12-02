'use strict';

const Joi = require('joi');

const internals = {};

internals.model = Joi.func();

internals.knexEnvConfig = Joi.object({
    client: Joi.string().required(),
    connection: Joi.object({
        socketPath: Joi.string().optional(),
        host: Joi.string().optional(),
        port: Joi.number().optional(),
        user: Joi.string().optional(),
        password: Joi.string().optional(),
        database: Joi.string().optional(),
        filename: Joi.string().optional()
    }),
    useNullAsDefault: Joi.boolean().optional(),
    debug: Joi.boolean().optional(),
    pool: Joi.object({
        min: Joi.number().optional(),
        max: Joi.number().optional()
    }).optional(),
    acquireConnectionTimeout: Joi.number().optional()
});

internals.knexFile = Joi.object({
    development: internals.knexEnvConfig,
    production: internals.knexEnvConfig,
    test: internals.knexEnvConfig,
});

exports.plugin = internals.knexFile.keys({
    models: [
        Joi.string(),
        Joi.array().items(internals.model)
    ],
    defaults: Joi.object(),
    teardownOnStop: Joi.boolean()
});

exports.schwifty = Joi.alternatives().try(
    Joi.array().items(internals.model).single(),
    internals.knexFile.keys({
        models: Joi.array().items(internals.model).optional()
    })
);
