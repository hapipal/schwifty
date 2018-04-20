'use strict';

// Allowing path to be set for testing
exports.get = (path) => {

    path = path || 'schwifty-migrate-diff';

    let SchwiftyMigrateDiff;
    try {
        SchwiftyMigrateDiff = require(path);
    }
    catch (err) {
        SchwiftyMigrateDiff = null;
    }
    return SchwiftyMigrateDiff;
};
