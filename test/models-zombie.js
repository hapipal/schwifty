'use strict';

const Joi = require('joi');
const Model = require('..').Model;

module.exports = [

    class Zombie extends Model {

        static get tableName() {

            return 'Zombie';
        }

        static get schema() {

            return Joi.object({

                /*
                    Note: in these schemas, whatever is required() is also required when
                    querying for it FROM the database as well.
                */

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
    }
];
