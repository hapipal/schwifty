'use strict';

const Somever = require('@hapi/somever');

// Test against joi v17 (supports node v12+) or joi v16 (supports down to node v8) conditionally
module.exports = Somever.match(process.version, '>=12') ? require('joi') : require('@hapi/joi');
