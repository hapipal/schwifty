'use strict';

const Joi = require('joi');
const Model = require('..').Model;

module.exports = [

    class Movie extends Model {

        static get tableName() {

            return 'Movie';
        }

        static get schema() {

            return Joi.object({

                // Note: in these schemas, whatever is required() is also required when
                // querying for it FROM the database as well.

                title: Joi.string(),
                subTitle: Joi.string()
            });
        }
    }
];
