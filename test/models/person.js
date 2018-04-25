'use strict';

const Joi = require('joi');
const Schwifty = require('../..');

module.exports = class Person extends Schwifty.Model {

    static get tableName() {

        return 'Person';
    }

    static get joiSchema() {

        return Joi.object({
            firstName: Joi.string().required().max(255),
            lastName: Joi.number(),
            age: Joi.number().integer(),
            address: Joi.object({
                street: Joi.string(),
                city: Joi.string(),
                zipCode: Joi.string()
            })
        });
    }
};
