'use strict';

const Model = require('..').Model;

module.exports = [

    class Dog extends Model {

        static get tableName() {

            return 'Dog';
        }

        static customFunc() {

            return 'Custom func called!';
        }

        static get schema() {

            return Joi.object({

                // Note: in these schemas, whatever is required() is also required when
                // querying for it FROM the database as well.

                favoriteToy: Joi.string(),
                superFavoriteToy: Joi.number(),
                doggyName: Joi.number(),
                // age: Joi.number().integer(),
                ownerId: Joi.number().integer()
            });
        }
    },
    class Person extends Model {

        static get tableName() {

            return 'Person';
        }

        static customFunc() {

            return 'Custom func called!';
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

        // static get relationMappings() {

        //     return {
        //         dogs: {
        //             relation: Model.ManyToManyRelation,
        //             modelClass: Dog,
        //             join: {
        //                 from: 'Person.id',
        //                 to: 'Doggy.ownerId',
        //                 through: {
        //                     from: 'Person_Doggy.personId',
        //                     to: 'Person_Doggy.dogId'
        //                 }
        //             }
        //         }
        //     };
        // }
    }
];
