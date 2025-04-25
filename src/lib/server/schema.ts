import { pgTable, text, integer, real, timestamp } from 'drizzle-orm/pg-core';

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
    permalink: text().notNull().unique(),
    latitude: real(),
    longitude: real(),
    tags: text().array(),
    scrapedAt: timestamp().notNull().defaultNow(),
});

export type InsertEvent = typeof events.$inferInsert;
export type SelectEvent = typeof events.$inferSelect; 