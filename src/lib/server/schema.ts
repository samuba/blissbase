import { pgTable, text, integer, real, timestamp, unique } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    startAt: timestamp().notNull(),
    endAt: timestamp(),
    address: text().notNull().array(),
    price: text(),
    description: text(),
    imageUrls: text().notNull().array(),
    host: text(),
    hostLink: text(),
    sourceUrl: text().unique(),
    contact: text(),
    latitude: real(),
    longitude: real(),
    tags: text().array(),
    source: text().notNull(),
    scrapedAt: timestamp().notNull().defaultNow(),
}, (table) => {
    return {
        uniqueNameStartAtAddress: unique().on(table.name, table.startAt, table.address),
    };
});

export const geocodeCache = pgTable('geocode_cache', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    address: text().notNull().unique(),
    latitude: real(),
    longitude: real(),
    cachedAt: timestamp().notNull().defaultNow(),
});