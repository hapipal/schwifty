'use strict';

const Hoek = require('@hapi/hoek');
const Objection = require('objection');
const Helpers = require('./helpers');

const internals = {};

module.exports = class SchwiftyModel extends Objection.Model {

    static createValidator() {

        return new internals.Validator();
    }

    // Used by objection for bindKnex() caching
    static uniqueTag(...args) {

        if (!this.hasOwnProperty('$$schwiftyUniqueId')) {
            Helpers.setNonEnumerableProperty(
                this,
                '$$schwiftyUniqueId',
                ++SchwiftyModel.$$schwiftyUniqueCounter
            );
        }

        // Typically "{table-name}_{model-name}"
        let uniqueTag = super.uniqueTag(...args);

        if (Helpers.getSandbox(this)) {
            // We need to provide an id because it's possible that a sandboxed
            // model might have the same model name and table name (i.e. same unique tag)
            // as another model on the server. That works great in schwifty/hapi, but
            // does not work nicely with objection's bindKnex() cache. We additionally
            // copy the same $$schwiftyUniqueId to the bound model (within bindKnex() and
            // bindTransaction()) so that bound models remain indistiguishable from unbound models.
            uniqueTag += `_id:${this.$$schwiftyUniqueId}`;
        }

        return uniqueTag;
    }

    static bindKnex(...args) {

        const BoundModel = super.bindKnex(...args);

        return internals.copyProperties(this, BoundModel);
    }

    static bindTransaction(...args) {

        const BoundModel = super.bindTransaction(...args);

        return internals.copyProperties(this, BoundModel);
    }

    static get joiSchemaPatch() {

        if (this.hasOwnProperty('$$joiSchemaPatch')) {
            return this.$$joiSchemaPatch;
        }

        if (!this.joiSchema) {
            return;
        }

        this.joiSchemaPatch = internals.patchSchema(this.joiSchema);

        return this.joiSchemaPatch;
    }

    static set joiSchemaPatch(value) {

        Helpers.setNonEnumerableProperty(
            this,
            '$$joiSchemaPatch',
            value
        );
    }

    static field(name) {

        Hoek.assert(this.joiSchema, `Model does not have a joi schema.`);

        const fullSchema = this.joiSchema.extract(name);

        return fullSchema
            .optional()
            .prefs({ noDefaults: true })
            .alter({
                full: () => fullSchema,
                patch: (schema) => schema
            });
    }

    // Applies default jsonAttributes based upon joiSchema,
    // otherwise fallsback to however jsonAttributes has been set
    static get jsonAttributes() {

        // Once it's set, never recompute from joiSchema
        if (this.hasOwnProperty('$$schwiftyJsonAttributes')) {
            return this.$$schwiftyJsonAttributes;
        }

        if (!this.joiSchema) {
            return;
        }

        const schemaKeyDescs = this.joiSchema.describe().keys || {};

        // Will set the memo, see the jsonAttributes setter
        this.jsonAttributes = Object.keys(schemaKeyDescs).filter((field) => {

            const { type } = schemaKeyDescs[field];

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

        Helpers.setNonEnumerableProperty(
            this,
            '$$schwiftyJsonAttributes',
            value
        );
    }
};

Helpers.setNonEnumerableProperty(module.exports, '$$schwiftyUniqueCounter', 0);

internals.Validator = class SchwiftyValidator extends Objection.Validator {

    beforeValidate(args) {

        const { json, model, options, ctx } = args;

        ctx.joiSchema = options.patch ? model.constructor.joiSchemaPatch : model.constructor.joiSchema;

        if (model.$beforeValidate !== Objection.Model.prototype.$beforeValidate) {
            ctx.joiSchema = model.$beforeValidate(ctx.joiSchema, json, options);
        }
    }

    validate(args) {

        const { json, model, ctx } = args;

        if (!ctx.joiSchema) {
            return json;
        }

        const validation = ctx.joiSchema.validate(json);

        if (validation.error) {
            throw internals.parseJoiValidationError(validation, model.constructor);
        }

        return validation.value;
    }
};

internals.patchSchema = (schema) => {

    const keys = Object.keys(schema.describe().keys || {});

    // Make all keys optional, do not enforce defaults

    if (keys.length) {
        schema = schema.fork(keys, (s) => s.optional());
    }

    return schema.prefs({ noDefaults: true });
};

// Converts a Joi error object to the format the Object.ValidationError constructor expects as input
// https://github.com/Vincit/objection.js/blob/aa3f1a0bb830211e478aa6a664561155c98850f4/lib/model/ValidationError.js#L10
internals.parseJoiValidationError = (validation, Model) => {

    const errors = validation.error.details;
    const validationInfo = {
        data: {},
        type: 'ModelValidation'
    };

    // We don't set a message, as Objection will build an error message from the message properties of
    // values within the data property of the ValidationError constructor's input
    for (let i = 0; i < errors.length; ++i) {
        const error = errors[i];

        validationInfo.data[error.path] = validationInfo.data[error.path] || [];
        validationInfo.data[error.path].push({
            // Format matches data property documented here: http://vincit.github.io/objection.js/#validationerror
            message: error.message,
            keyword: error.type,
            params: error.context
        });
    }

    // inherited standard method on Objection models (http://vincit.github.io/objection.js/#createvalidationerror)
    // just handles creating a standard ValidationError
    return Model.createValidationError(validationInfo);
};

internals.copyProperties = (SourceModel, TargetModel) => {

    if (!TargetModel.hasOwnProperty('$$schwiftyBound')) {

        internals.hoistModelProperties.forEach((property) => {

            Helpers.copyDescriptor(property, SourceModel, TargetModel);
        });

        Helpers.setNonEnumerableProperty(TargetModel, '$$schwiftyBound', true);
    }

    return TargetModel;
};

internals.hoistModelProperties = [
    Helpers.symbols.sandbox,
    '$$schwiftyUniqueId',
    '$$joiSchemaPatch',
    '$$schwiftyJsonAttributes'
];
