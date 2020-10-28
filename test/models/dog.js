'use strict';

const Joi = require('joi');
const { Model } = require('../..');

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
