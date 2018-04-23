'use strict';

exports.up = (knex, Promise) => {

    return knex.schema
        .createTableIfNotExists('Dog', (table) => {

            table.string('favoriteToy');
            table.float('name');
            table.integer('ownerId');
        })
        .createTableIfNotExists('Person', (table) => {

            table.string('firstName');
            table.float('lastName');
            table.integer('age');
            table.json('address');
        });
};

exports.down = (knex, Promise) => {

    return knex.schema
        .dropTable('Dog')
        .dropTable('Person');
};
