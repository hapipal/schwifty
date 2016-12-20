'use strict';

const Joi = require('joi');
const Model = require('..').Model;

module.exports = [

    class Dog extends Model {

        static get tableName() {

            return 'Dog';
        }

        static customFunc() {

            return 'Custom func called from Dog!';
        }

        static get schema() {

            return Joi.object({

                // Note: in these schemas, whatever is required() is also required when
                // querying for it FROM the database as well.

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

        static customFunc() {

            return 'Custom func called from Person!';
        }

        upsert(model) {

            if (model.id) {
                return this.update(model).where('id', model.id);
            }

            return this.insert(model);
        }

        static get schema() {

            return Joi.object({

                /*
                    Note: in these schemas, whatever is required() is also required when
                    querying for it FROM the database as well.
                */

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
