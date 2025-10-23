import { sql, type SQL, relations } from 'drizzle-orm';
import { pgTable, text, integer, real, timestamp, boolean, jsonb, uuid, uniqueIndex, bigint, primaryKey } from 'drizzle-orm/pg-core';

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
    imageUrls: text().notNull().array(),
    host: text(),
    hostLink: text(),
    sourceUrl: text(),
    contact: text().array().default([]).notNull(),
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
    telegramRoomIds: text().array(),
    hostSecret: text(),
    isOnline: boolean().notNull().default(false),
});

export const eventsRelations = relations(events, ({ many }) => ({
    eventTags: many(eventTags),
}));

export const botMessages = pgTable('message_to_bot', {
    id: uuid().primaryKey().defaultRandom(),
    data: jsonb().notNull(),
    origin: text().generatedAlwaysAs((): SQL => sql`COALESCE((data->'chat'->>'title')::text, (data->'chat'->>'username')::text)`),
    text: text().generatedAlwaysAs((): SQL => sql`COALESCE((data->>'text')::text, (data->>'caption')::text)`),
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

export const telegramChatConfig = pgTable('telegram_chat_config', {
    chatId: bigint({ mode: 'bigint' }).primaryKey(),
    chatName: text(), // telegram group or channel name
    defaultAddress: text().array(),
    createdAt: timestamp().notNull().defaultNow(),
});

export const telegramScrapingTargets = pgTable('telegram_scraping_targets', {
    roomId: text().primaryKey(),
    name: text(), // telegram group or channel name
    lastMessageId: bigint({ mode: 'bigint' }),
    lastMessageTime: timestamp(),
    defaultAddress: text().array(),
    createdAt: timestamp().notNull().defaultNow(),
    messagesConsumed: integer().notNull().default(0),
    lastError: text(),
    scrapedEvents: integer().notNull().default(0),
    lastRunFinishedAt: timestamp(),
    topicIds: bigint({ mode: 'bigint' }).array().notNull().default([]),
});

export type TelegramScrapingTarget = typeof telegramScrapingTargets.$inferSelect;

// All images are cached in R2. For website-scraped-images we remember the original url so that we dont need to process the image again.
export const imageCacheMap = pgTable('image_cache_map', {
    originalUrl: text().notNull(),
    eventSlug: text().notNull(),
    url: text().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.originalUrl, t.eventSlug] })
]);

export const tags = pgTable('tags', {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slug: text().notNull().unique(),
    createdAt: timestamp().notNull().defaultNow(),
});

export type Tag = typeof tags.$inferSelect;

export const tagsRelations = relations(tags, ({ many }) => ({
    translations: many(tagTranslations),
    eventTags: many(eventTags),
}));

export const tagTranslations = pgTable('tag_translations', {
    tagId: integer().notNull().references(() => tags.id, { onDelete: 'cascade' }),
    locale: text().notNull(), // e.g. 'en', 'de', 'id'
    name: text().notNull(),   // e.g. "Yoga", "Meditation", "Meditasi"
}, (t) => [
    uniqueIndex().on(t.tagId, t.locale)
]);

export type TagTranslation = typeof tagTranslations.$inferSelect;

export const tagTranslationsRelations = relations(tagTranslations, ({ one }) => ({
    tag: one(tags, {
        fields: [tagTranslations.tagId],
        references: [tags.id],
    }),
}));

export const eventTags = pgTable('event_tags', {
    eventId: integer().notNull().references(() => events.id, { onDelete: 'cascade' }),
    tagId: integer().notNull().references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp().notNull().defaultNow(),
}, (t) => [
    primaryKey({ columns: [t.eventId, t.tagId] })
]);

export type EventTag = typeof eventTags.$inferSelect;

export const eventTagsRelations = relations(eventTags, ({ one }) => ({
    event: one(events, {
        fields: [eventTags.eventId],
        references: [events.id],
    }),
    tag: one(tags, {
        fields: [eventTags.tagId],
        references: [tags.id],
    }),
}));




/*** Cronjobs ***/
// SELECT cron.schedule(
//     'purge-megssage-to-bot',
//     '*/5 * * * *',  -- every 5 minutes
//     $$
//         DELETE FROM message_to_bot
//         WHERE created_at < NOW() - INTERVAL '30 days';
//     $$
// );
