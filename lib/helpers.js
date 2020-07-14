'use strict';

exports.symbols = {};

exports.symbols.sandbox = Symbol('schwiftySandbox');

exports.symbols.bindKnex = Symbol('schwiftyBindKnex');

exports.getName = (Model) => Model.name;

exports.getSandbox = (obj) => {

    const sandbox = obj[exports.symbols.sandbox];

    if (sandbox === 'plugin') {
        return true;
    }

    if (sandbox === 'server') {
        return false;
    }

    return sandbox;
};

exports.getBindKnex = (Model) => Model[exports.symbols.bindKnex] !== false;

exports.setNonEnumerableProperty = (obj, prop, value) => {

    Object.defineProperty(obj, prop, {
        enumerable: false,
        writable: true,
        configurable: true,
        value
    });
};

exports.copyDescriptor = (name, from, to) => {

    const descriptor = Object.getOwnPropertyDescriptor(from, name);

    if (descriptor) {
        Object.defineProperty(to, name, descriptor);
    }
};
