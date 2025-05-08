import type { events } from "./server/schema";

/**
 * Shared interface for scraped event data.
 */
export interface ScrapedEvent {
    name: string;
    startAt: string; // ISO 8601 includes time if available, otherwise YYYY-MM-DD
    endAt: string | null; // ISO 8601 includes time if available, otherwise YYYY-MM-DD, optional
    address: string[]; // Array of address lines
    price: string | null; // From priceRange or specific price element, can be null
    description: string | null; // Description as HTML or cleaned text, can be null
    imageUrls: string[]; // All images from detail page
    host: string | null; // Host name (artist/organizer)
    hostLink: string | null; // Link to host profile
    permalink: string; // Event detail page URL (should be unique)
    latitude: number | null;
    longitude: number | null;
    tags: string[]; // Tags/Categories from the event page
}

export type InsertEvent = typeof events.$inferInsert;