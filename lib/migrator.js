'use strict';

const internals = {};

exports.migrate = async (migrations, rollback) => {

    for (const [knex, migrationsDirHash] of migrations) {
        await internals.executeMigration(knex, Object.keys(migrationsDirHash), rollback);
    }
};

internals.executeMigration = async (knex, migrationsDirs, rollback) => {

    const latestOrRollback = rollback ? 'rollback' : 'latest';

    await knex.migrate[latestOrRollback]({ directory: migrationsDirs });
};
