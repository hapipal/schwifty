'use strict';

const Joi = require('joi');
const Schwifty = require('../..');

module.exports = class Zombie extends Schwifty.Model {

    static get tableName() {

        return 'Zombie';
    }

    static get joiSchema() {

        return Joi.object({
            firstName: Joi.string().required().max(255),
            lastName: Joi.string(),
            age: Joi.number().integer(),
            address: Joi.object({
                street: Joi.string(),
                city: Joi.string(),
                zipCode: Joi.string()
            }),
            favoriteFood: Joi.string().default('Tasty brains')
        });
    }
};
