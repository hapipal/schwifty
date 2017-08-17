'use strict';

const Objection = require('objection');

const internals = {};

module.exports = class SchwiftyModel extends Objection.Model {

    static createValidator() {

        return new internals.Validator();
    }

    // Caches schema, with and without optional keys
    // Will create $$joiSchema and $$joiSchemaPatch properties
    static getJoiSchema(patch) {

        if (!this.hasOwnProperty('$$joiSchema')) {
            internals.setNonEnumerableProperty(
                this,
                '$$joiSchema',
                this.joiSchema
            );
        }

        const schema = this.$$joiSchema;

        if (patch) {
            if (!this.hasOwnProperty('$$joiSchemaPatch')) {
                internals.setNonEnumerableProperty(
                    this,
                    '$$joiSchemaPatch',
                    internals.patchSchema(schema)
                );
            }

            return this.$$joiSchemaPatch;
        }

        return schema;
    }

    // Applies default jsonAttributes based upon joiSchema,
    // otherwise fallsback to however jsonAttributes has been set
    static get jsonAttributes() {

        // Once it's set, never recompute from joiSchema
        if (this.hasOwnProperty('$$schwiftyJsonAttributes')) {
            return this.$$schwiftyJsonAttributes;
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

        internals.setNonEnumerableProperty(
            this,
            '$$schwiftyJsonAttributes',
            value
        );
    }
};

internals.Validator = class SchwiftyValidator extends Objection.Validator {

    beforeValidate(args) {

        const json = args.json;
        const model = args.model;
        const options = args.options;
        const ctx = args.ctx;

        ctx.joiSchema = model.constructor.getJoiSchema(options.patch);

        if (model.$beforeValidate !== Objection.Model.prototype.$beforeValidate) {
            ctx.joiSchema = model.$beforeValidate(ctx.joiSchema, json, options);
        }
    }

    validate(args) {

        const json = args.json;
        const ctx = args.ctx;

        if (!ctx.joiSchema) {
            return json;
        }

        const validation = ctx.joiSchema.validate(json);

        if (validation.error) {
            const info = internals.parseJoiValidationError(validation);
            throw new Objection.ValidationError(info);
        }

        return validation.value;
    }
};

internals.setNonEnumerableProperty = (obj, prop, value) => {

    Object.defineProperty(obj, prop, {
        enumerable: false,
        writable: true,
        configurable: true,
        value
    });
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

internals.parseJoiValidationError = (validation) => {

    const errors = validation.error.details;
    const validationInfo = {};

    for (let i = 0; i < errors.length; ++i) {
        const error = errors[i];

        validationInfo[error.path] = validationInfo[error.path] || [];
        validationInfo[error.path].push({
            message: error.message,
            keyword: error.type,
            params: error.context
        });
    }

    return validationInfo;
};
