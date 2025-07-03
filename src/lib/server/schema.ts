import { sql, type SQL } from 'drizzle-orm';
import { pgTable, text, integer, real, timestamp, boolean, jsonb, uuid, uniqueIndex } from 'drizzle-orm/pg-core';

export const events = pgTable('events', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    startAt: timestamp().notNull(),
    endAt: timestamp(),
    address: text().notNull().array(),
    price: text(),
    priceIsHtml: boolean().notNull().default(false),
    description: text(),
    descriptionOriginal: text(),
    summary: text(),
    imageUrls: text().notNull().array(),
    host: text(),
    hostLink: text(),
    sourceUrl: text(),
    contact: text(),
    latitude: real(),
    longitude: real(),
    tags: text().array(),
    source: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp().notNull().defaultNow(),
    messageSenderId: text(), // messenger id of the user that sent this event via messenger, eg telegram.
    slug: text().notNull().unique(),
    soldOut: boolean().notNull().default(false),
    listed: boolean().notNull().default(true),
});


export const botMessages = pgTable('message_to_bot', {
    id: uuid().primaryKey().defaultRandom(),
    data: jsonb().notNull(),
    text: text().generatedAlwaysAs((): SQL => sql`(data->>'text')::text`),
    answer: text(),
    createdAt: timestamp().notNull().defaultNow(),
});


export const geocodeCache = pgTable('geocode_cache', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    address: text().notNull().unique(),
    latitude: real(),
    longitude: real(),
    cachedAt: timestamp().notNull().defaultNow(),
});

export const reverseGeocodeCache = pgTable('reverse_geocode_cache', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    latitude: real().notNull(),
    longitude: real().notNull(),
    cityName: text(),
    cachedAt: timestamp().notNull().defaultNow(),
}, (t) => [
    uniqueIndex().on(t.latitude, t.longitude)
]);



/*** Cronjobs ***/
// SELECT cron.schedule(
//     'purge-megssage-to-bot',
//     '*/5 * * * *',  -- every 5 minutes
//     $$
//         DELETE FROM message_to_bot
//         WHERE created_at < NOW() - INTERVAL '30 days';
//     $$
// );
