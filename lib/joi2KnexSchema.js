
const Hoek = require('hoek');

const internals = {};

internals.joiDictionary = {
    string      : 'string',
    boolean     : 'boolean',
    date        : 'date',
    binary      : 'binary',
    number      : 'integer',
    array       : 'json',
    object      : 'json',
    // alternatives: null,
    any         : 'string'
};

module.exports = (joiSchema) => {

    joiSchema = joiSchema.describe();

    const schemaKeys = Object.keys(joiSchema.children);

    const columns = {};

    schemaKeys.forEach((schemaKey) => {

        const childType = joiSchema.children[schemaKey].type;
        const columnType = internals.joiDictionary[childType];

        Hoek.assert(columnType, 'Schema type ' + childType + ' not supported');

        columns[schemaKey] = columnType;
    });

    return columns;
}
