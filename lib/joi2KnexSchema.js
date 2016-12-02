
const Hoek = require('hoek');

const internals = {};

/*
    Map:
    {
        'Joi-type': 'knex-column-type'
    }

    Joi types found in their docs: https://github.com/hapijs/joi/blob/v10.0.1/API.md
    Knex schema types are found starting here: http://knexjs.org/#Schema-integer
*/

internals.joiDictionary = {
    string      : 'string',
    boolean     : 'boolean',
    date        : 'date',
    binary      : 'binary', // This is 1000001010100101010, not true/false
    number      : 'integer', // Need to differentiate between floating numbers, and event 'big integers' for knex
    array       : 'json', // Caveat with knex: must JSON.stringify before saving an array as 'json'
    object      : 'json', // Auto JSON.stringifies for you
    uuid        : 'uuid',
    guid        : 'uuid',
    // alternatives: null,
    any         : 'string'
};

module.exports = (joiSchema) => {

    // A simple mapper between Joi types and supported knex schema column types

    joiSchema = joiSchema.describe();

    // Assumes a model's schema is a single Joi object with children
    const schemaKeys = Object.keys(joiSchema.children);

    const columns = {};

    schemaKeys.forEach((schemaKey) => {

        const childType = joiSchema.children[schemaKey].type;
        const columnType = internals.joiDictionary[childType];

        // If we don't have a joi type in our map above, we're gonna have a problem
        Hoek.assert(columnType, 'Schema type ' + childType + ' not supported');

        columns[schemaKey] = columnType;
    });

    return columns;
}
