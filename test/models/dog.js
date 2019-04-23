'use strict';

const Joi = require('@hapi/joi');
const Model = require('../..').Model;

module.exports = class Dog extends Model {

    static get tableName() {

        return 'Dog';
    }

    static get joiSchema() {

        return Joi.object({
            favoriteToy: Joi.string(),
            name: Joi.number(),
            ownerId: Joi.number().integer()
        });
    }
};
