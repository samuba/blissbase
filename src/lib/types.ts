import type { events } from "./server/schema";
import type { WebsiteScrapeSource } from "../../scripts/common";

/**
 * Shared interface for scraped event data.
 */
export interface ScrapedEvent {
    name: string;
    startAt: string; // ISO string with timezone offset
    endAt: string | null | undefined; // ISO string with timezone offset
    address: string[]; // Array of address lines
    price: string | null | undefined; // From priceRange or specific price element, can be null | undefined
    priceIsHtml: boolean; // Whether the price is HTML or not
    description: string | null | undefined; // Description as HTML or cleaned text, can be null | undefined
    imageUrls: string[]; // All images from detail page
    host: string | null | undefined; // Host name (artist/organizer)
    hostLink: string | null | undefined; // Link to host profile
    contact: string[]  // Contact method (email, whatsapp, telegram, url)
    latitude: number | null | undefined;
    longitude: number | null | undefined;
    tags: string[]; // Tags/Categories from the event page
    sourceUrl: string; // Event detail page URL (should be unique)
    source: WebsiteScrapeSource; // Source of the event e.g. 'awara', 'tribehaus', 'heilnetz', 'seijetzt'
}

export type InsertEvent = typeof events.$inferInsert;