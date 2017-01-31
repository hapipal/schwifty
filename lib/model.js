'use strict';

const Objection = require('objection');

const internals = {};

module.exports = class SchwiftyModel extends Objection.Model {

    // Caches schema, with and without optional keys
    // Will create _schemaMemo and _optionalSchemaMemo properties
    static getJoiSchema(patch) {

        if (!this.hasOwnProperty('_schemaMemo')) {
            this._schemaMemo = this.joiSchema;
        }

        const schema = this._schemaMemo;

        if (patch) {
            if (!this.hasOwnProperty('_patchSchemaMemo')) {
                this._patchSchemaMemo = internals.patchSchema(schema);
            }

            const patchSchema = this._patchSchemaMemo;

            return patchSchema;
        }

        return schema;
    }

    // Applies default jsonAttributes based upon joiSchema,
    // otherwise fallsback to however jsonAttributes has been set
    static get jsonAttributes() {

        // Once it's set, never recompute from joiSchema
        if (this.hasOwnProperty('_jsonAttributesMemo')) {
            return this._jsonAttributesMemo;
        }

        const joiSchema = this.getJoiSchema();

        if (!joiSchema) {
            return null;
        }

        const schemaKeyDescs = joiSchema.describe().children || {};

        // Will set the memo, see the jsonAttributes setter
        this.jsonAttributes = Object.keys(schemaKeyDescs).filter((field) => {

            const type = schemaKeyDescs[field].type;

            // These are the joi types we want to be parsed/serialized as json
            return (type === 'array') || (type === 'object');
        });

        // Yes, this will re-enter the getter, but it's
        // guaranteed not to loop because the memo is set
        return this.jsonAttributes;
    }

    // This is a necessity because jsonAttributes must
    // remain settable for objection's base Model class.
    // Behold.
    static set jsonAttributes(value) {

        this._jsonAttributesMemo = value;
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
            const errors = this.constructor.parseJoiValidationError(validation);
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
