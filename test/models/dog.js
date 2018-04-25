'use strict';

const Joi = require('joi');
const Schwifty = require('../..');

module.exports = class Dog extends Schwifty.Model {

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
