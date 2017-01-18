'use strict';

const Objection = require('objection');

const internals = {};

module.exports = class SchwiftyModel extends Objection.Model {

    static get joiSchema() {}

    // Caches schema, with and without optional keys
    // Will create _schemaMemo and _optionalSchemaMemo properties
    static getJoiSchema(patch) {

        const schema = this._schemaMemo = this._schemaMemo || this.joiSchema;

        if (patch) {
            const patchSchema = this._patchSchemaMemo = this._patchSchemaMemo || internals.patchSchema(schema);
            return patchSchema;
        }

        return schema;
    }

    // Will create _jsonAttributesMemo properties
    static get jsonAttributes() {

        if (this._jsonAttributesMemo) {
            return this._jsonAttributesMemo;
        }

        const joiSchema = this.getJoiSchema();

        if (!joiSchema) {
            return null;
        }

        const schemaKeyDescs = joiSchema.describe().children || {};

        // Setting this._jsonAttributesMemo here.
        this.jsonAttributes = Object.keys(schemaKeyDescs).filter((field) => {

            const type = schemaKeyDescs[field].type;

            // These are the joi types we want to be parsed/serialized as json
            return (type === 'array') || (type === 'object');
        });

        return this.jsonAttributes;
    }

    /*
    This is here as a necessity because classes can't have
    a getter without the setter for a prop. Schwifty's Model
    classes don't implement a setter for jsonAttributes.

    behold. */
    static set jsonAttributes(value) {

        this._jsonAttributesMemo = value || [];
    }

    static parseJoiValidationError(validation) {

        return validation.error.details;
    }

    $validate(json, options) { // Note, in objection v0.7.x there is a new Validator interface

        json = json || this.$parseJson(this.$toJson(true));
        options = options || {};

        let joiSchema = this.constructor.getJoiSchema(options.patch);

        if (!joiSchema || options.skipValidation) {
            return json;
        }

        // Allow modification of schema, setting of options, etc.
        joiSchema = this.$beforeValidate(joiSchema, json, options);

        const validation = joiSchema.validate(json);

        if (validation.error) {
            const errors = SchwiftyModel.parseJoiValidationError(validation);
            throw new Objection.ValidationError(errors);
        }

        json = validation.value;

        this.$afterValidate(json, options);

        return json;
    }
};

internals.patchSchema = (schema) => {

    if (!schema) {
        return;
    }

    const keys = Object.keys(schema.describe().children || {});

    // Make all keys optional, do not enforce defaults

    if (keys.length) {
        schema = schema.optionalKeys(keys);
    }

    return schema.options({ noDefaults: true });
};
