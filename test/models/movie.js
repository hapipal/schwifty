'use strict';

const Joi = require('joi');
const { Model } = require('../..');

module.exports = class Movie extends Model {

    static get tableName() {

        return 'Movie';
    }

    static get joiSchema() {

        return Joi.object({
            title: Joi.string(),
            subTitle: Joi.string()
        });
    }
};
