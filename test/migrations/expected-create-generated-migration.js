'use strict';

exports.up = (knex, Promise) => {

    return knex.schema
        .createTable('Dog', (table) => {

            table.string('favoriteToy');
            table.float('name');
            table.integer('ownerId');
        })
        .alterTable('Person', (table) => {

            table.string('hometown');
        });
};

exports.down = (knex, Promise) => {

    return knex.schema
        .dropTable('Dog')
        .alterTable('Person', (table) => {

            table.dropColumn('hometown');
        });
};
