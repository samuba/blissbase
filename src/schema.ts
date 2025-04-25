import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Drizzle schema for storing scraped events in SQLite.
 */
export const events = sqliteTable('events', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    startAt: text('start_at').notNull(), // ISO 8601 string
    endAt: text('end_at'), // ISO 8601 string, nullable
    address: text('address', { mode: 'json' }).$type<string[]>(), // Store address lines as JSON array
    price: text('price'), // Nullable string
    description: text('description'), // Nullable string (can be long)
    imageUrls: text('image_urls', { mode: 'json' }).$type<string[]>(), // Store image URLs as JSON array
    host: text('host'), // Nullable string
    hostLink: text('host_link'), // Nullable string
    permalink: text('permalink').notNull().unique(), // Unique identifier for the event
    latitude: real('latitude'), // Nullable float
    longitude: real('longitude'), // Nullable float
    tags: text('tags', { mode: 'json' }).$type<string[]>(), // Store tags as JSON array
    scrapedAt: text('scraped_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export type InsertEvent = typeof events.$inferInsert;
export type SelectEvent = typeof events.$inferSelect; 