'use strict';

const Hoek = require('hoek');

// Allowing path to be set for testing
exports.get = (path) => {

    path = path || 'schwifty-migrate-diff';

    let SchwiftyMigrateDiff;
    try {
        SchwiftyMigrateDiff = require(path);
    }
    catch (err) {
        Hoek.assert(err.code === 'MODULE_NOT_FOUND' && ~err.message.indexOf(path), err);
        SchwiftyMigrateDiff = null;
    }
    return SchwiftyMigrateDiff;
};
