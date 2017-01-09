'use strict';

const Joi = require('joi');
const Model = require('..').Model;

module.exports = [
    class Dog extends Model {

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
    },
    class Person extends Model {

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
    }
];
