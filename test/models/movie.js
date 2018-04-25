'use strict';

const Joi = require('joi');
const Schwifty = require('../..');

module.exports = class Movie extends Schwifty.Model {

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
