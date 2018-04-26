'use strict';

const Hoek = require('hoek');

// Allowing path to be set for testing

exports.getSchwiftyMigrateDiff = (path = 'schwifty-migrate-diff') => {

    try {
        return require(path);
    }
    catch (err) {
        Hoek.assert(err.code === 'MODULE_NOT_FOUND' && ~err.message.indexOf(path), err);
    }
};
