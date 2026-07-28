/**
 * Scrapes events from tantrakalender.de via the public Supabase REST API.
 *
 * No browser needed — the React frontend reads `seminare`, `tagesseminare`
 * and `urlaubsseminare` that we query here with the anon key from their bundle.
 *
 * Usage:
 *   bun run scripts/scrape-tantrakalender.ts
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	sleep,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const SITE_BASE = `https://tantrakalender.de`;
const SUPABASE_URL = `https://rzybwlgnmuysywtblhpe.supabase.co`;
const SUPABASE_KEY = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6eWJ3bGdubXV5c3l3dGJsaHBlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMTcwNjIsImV4cCI6MjA4NDU5MzA2Mn0.4k5umpsiFSVmDn9evLPgE_xscjJZrT0JVXqlKVMh9Wk`;
const PAGE_SIZE = 100;
const DEFAULT_TIMEZONE = `Europe/Berlin`;

const SOURCE_TABLES = [
	{ table: `seminare`, tag: `Mehrtägiges Seminar` },
	{ table: `tagesseminare`, tag: `Tagesseminar` },
	{ table: `urlaubsseminare`, tag: `Urlaubsseminar` },
] as const;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		console.error(`Fetching seminars from Tantrakalender Supabase...`);

		for (const source of SOURCE_TABLES) {
			try {
				const rows = await this.fetchUpcomingFromTable(source.table);
				console.error(`  ${source.table}: ${rows.length} upcoming`);

				for (const row of rows) {
					try {
						const event = await this.eventToScrapedEvent({ row, sourceTag: source.tag });
						if (!event) continue;
						allEvents.push(event);
					} catch (error) {
						console.error(`Failed to process ${source.table} ${row.id} (${row.name}):`, error);
					}
				}
			} catch (error) {
				console.error(`Failed to fetch ${source.table}:`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
	}

	async scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error(`Method not implemented.` + filePath);
	}

	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		throw new Error(`Method not implemented.` + html + url);
	}

	extractName(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractStartAt(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractEndAt(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractAddress(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractPrice(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractDescription(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractImageUrls(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractHost(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractHostLink(html: string): string | undefined {
		throw new Error(`Method not implemented.` + html);
	}
	extractTags(html: string): string[] | undefined {
		throw new Error(`Method not implemented.` + html);
	}

	private async fetchUpcomingFromTable(table: SourceTable): Promise<TantrakalenderSeminar[]> {
		const events: TantrakalenderSeminar[] = [];
		const today = new Date().toISOString().slice(0, 10);
		let offset = 0;

		while (true) {
			const params = new URLSearchParams({
				select: `*`,
				startDate: `gte.${today}`,
				order: `startDate.asc`,
				limit: String(PAGE_SIZE),
				offset: String(offset),
			});

			const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
				headers: {
					apikey: SUPABASE_KEY,
					Authorization: `Bearer ${SUPABASE_KEY}`,
					Accept: `application/json`,
				},
			});
			if (!res.ok) {
				throw new Error(`${table} query failed: ${res.status} ${await res.text()}`);
			}

			const page = (await res.json()) as TantrakalenderSeminar[];
			if (!page?.length) break;

			events.push(...page);
			if (page.length < PAGE_SIZE) break;

			offset += PAGE_SIZE;
			await sleep(100);
		}

		return events;
	}

	private async eventToScrapedEvent(args: {
		row: TantrakalenderSeminar;
		sourceTag: string;
	}): Promise<ScrapedEvent | undefined> {
		const { row, sourceTag } = args;

		const name = this.extractNameFromEvent(row);
		if (!name) {
			console.error(`Skipping event ${row.id} due to missing name.`);
			return undefined;
		}

		const startAt = this.extractStartAtFromEvent(row);
		if (!startAt) {
			console.error(`Skipping event ${row.id} (${name}) due to missing start date.`);
			return undefined;
		}

		const address = this.extractAddressFromEvent(row);
		let latitude: number | null = null;
		let longitude: number | null = null;
		let timezone: string | null = isLikelyGermany(address) ? DEFAULT_TIMEZONE : null;

		if (address?.length && !isOnlineLocation(address)) {
			try {
				const geocoded = await geocodeAddressCached({
					addressLines: address,
					apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
				});
				latitude = geocoded?.lat ?? null;
				longitude = geocoded?.lng ?? null;
				timezone = timezone ?? geocoded?.timezone ?? null;
			} catch (error) {
				console.error(`Geocoding failed for ${row.id}:`, error);
			}
		}
		timezone = timezone ?? DEFAULT_TIMEZONE;

		return {
			name,
			startAt,
			endAt: this.extractEndAtFromEvent(row),
			address,
			price: this.extractPriceFromEvent(row),
			priceIsHtml: false,
			description: this.extractDescriptionFromEvent(row),
			imageUrls: [],
			host: this.extractHostFromEvent(row),
			hostLink: this.extractHostLinkFromEvent(row),
			contact: this.extractContactFromEvent(row),
			latitude,
			longitude,
			timezone,
			tags: this.extractTagsFromEvent({ row, sourceTag }),
			sourceUrl: `${SITE_BASE}/seminar/${row.id}`,
			source: `tantrakalender`,
		} satisfies ScrapedEvent;
	}

	private extractNameFromEvent(event: TantrakalenderSeminar): string | undefined {
		const name = event.name?.trim();
		return name || undefined;
	}

	private extractStartAtFromEvent(event: TantrakalenderSeminar): string | undefined {
		return this.toIsoDateTime(event.startDate);
	}

	private extractEndAtFromEvent(event: TantrakalenderSeminar): string | undefined {
		const endDate = event.endDate || event.startDate;
		if (!endDate) return undefined;
		if (endDate === event.startDate) return undefined;
		return this.toIsoDateTime(endDate);
	}

	private extractAddressFromEvent(event: TantrakalenderSeminar): string[] {
		const location = event.location?.trim();
		if (!location) return [];
		return [location];
	}

	private extractPriceFromEvent(event: TantrakalenderSeminar): string | undefined {
		const price = toNumber(event.price);
		const earlyBird = toNumber(event.fruehbucher_preis);
		const womenPrice = toNumber(event.frauenpreis);

		if (price == null && earlyBird == null && womenPrice == null) return undefined;

		const parts: string[] = [];
		if (price != null) parts.push(formatEuro(price));
		if (earlyBird != null) parts.push(`Frühbucher ${formatEuro(earlyBird)}`);
		if (womenPrice != null) parts.push(`Frauen ${formatEuro(womenPrice)}`);
		return parts.join(` · `);
	}

	private extractDescriptionFromEvent(event: TantrakalenderSeminar): string | undefined {
		const raw = event.description?.trim();
		if (!raw) return undefined;
		const html = raw
			.split(/\r?\n+/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => `<p>${escapeHtml(line)}</p>`)
			.join(``);
		return cleanProseHtml(html) || undefined;
	}

	private extractHostFromEvent(event: TantrakalenderSeminar): string | undefined {
		const provider = event.provider?.trim();
		return provider || undefined;
	}

	private extractHostLinkFromEvent(event: TantrakalenderSeminar): string | undefined {
		const url = event.anbieterUrl?.trim();
		return url || undefined;
	}

	private extractContactFromEvent(event: TantrakalenderSeminar): string[] {
		const url = event.anbieterUrl?.trim();
		if (!url) return [];
		return [url];
	}

	private extractTagsFromEvent(args: {
		row: TantrakalenderSeminar;
		sourceTag: string;
	}): string[] {
		const { row, sourceTag } = args;
		const tags = new Set<string>([sourceTag, `Tantra`]);

		const duration = row.duration?.trim();
		if (duration) tags.add(duration);

		if (row.isLastMinute || row.islastminute) tags.add(`Last Minute`);

		return [...tags];
	}

	private toIsoDateTime(date: string | null | undefined): string | undefined {
		if (!date) return undefined;

		const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!dateMatch) return undefined;

		const year = Number(dateMatch[1]);
		const month = Number(dateMatch[2]);
		const day = Number(dateMatch[3]);
		return dateToIsoStr(year, month, day, 0, 0, DEFAULT_TIMEZONE, false);
	}
}

function formatEuro(amount: number) {
	const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(`.`, `,`);
	return `${value}€`;
}

function toNumber(value: number | string | null | undefined): number | null {
	if (value == null || value === ``) return null;
	const n = Number(value);
	if (Number.isNaN(n)) return null;
	return n;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function isOnlineLocation(address: string[]) {
	return address.some((line) => /\bonline\b/i.test(line));
}

function isLikelyGermany(address: string[]) {
	if (!address?.length) return true;
	const text = address.join(` `).toLowerCase();
	if (/\bonline\b/.test(text)) return true;
	if (/frankreich|france|korfu|corfu|österreich|austria|schweiz|switzerland|italien|italy|spanien|spain|portugal|griechenland|greece|bali|thailand|indien|india/.test(text)) {
		return false;
	}
	return true;
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		const events = await scraper.scrapeWebsite();
		console.log(JSON.stringify(events, null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type SourceTable = (typeof SOURCE_TABLES)[number][`table`];

type TantrakalenderSeminar = {
	id: string;
	name?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	location?: string | null;
	provider?: string | null;
	description?: string | null;
	price?: number | string | null;
	duration?: string | null;
	anbieterUrl?: string | null;
	fruehbucher_preis?: number | string | null;
	frauenpreis?: number | string | null;
	isLastMinute?: boolean | null;
	islastminute?: boolean | null;
};
