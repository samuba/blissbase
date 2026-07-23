/**
 * Scrapes events from tribehaus.app via the public Supabase REST API.
 *
 * No browser needed — the site's Next.js frontend reads the same `events`
 * table (joined with `creator_profiles`) that we query here.
 *
 * Usage:
 *   bun run scripts/scrape-tribehaus.ts
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	sleep,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const SITE_BASE = `https://tribehaus.app`;
const SUPABASE_URL = `https://fwmypbssafwsovnyruit.supabase.co`;
const SUPABASE_KEY = `sb_publishable_wnr2rf_udjvYgCR3ocIiXg_FodT5GZT`;
const PAGE_SIZE = 100;
const DEFAULT_TIMEZONE = `Europe/Berlin`;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];
		console.error(`Fetching published events from Tribehaus Supabase...`);
		const rows = await this.fetchAllUpcomingEvents();
		console.error(`Found ${rows.length} upcoming published events. Mapping...`);

		for (const row of rows) {
			try {
				const event = await this.eventToScrapedEvent(row);
				if (!event) continue;
				allEvents.push(event);
			} catch (error) {
				console.error(`Failed to process event ${row.id} (${row.title}):`, error);
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

	private async fetchAllUpcomingEvents(): Promise<TribehausEvent[]> {
		const events: TribehausEvent[] = [];
		const today = new Date().toISOString().slice(0, 10);
		let offset = 0;

		while (true) {
			const params = new URLSearchParams({
				select: `*,creator_profiles(id,slug,display_name,website)`,
				status: `eq.published`,
				or: `(end_date.gte.${today},and(end_date.is.null,start_date.gte.${today}))`,
				order: `start_date.asc`,
				limit: String(PAGE_SIZE),
				offset: String(offset),
			});

			const res = await fetch(`${SUPABASE_URL}/rest/v1/events?${params}`, {
				headers: {
					apikey: SUPABASE_KEY,
					Authorization: `Bearer ${SUPABASE_KEY}`,
					Accept: `application/json`,
				},
			});
			if (!res.ok) {
				throw new Error(`Tribehaus events query failed: ${res.status} ${await res.text()}`);
			}

			const page = (await res.json()) as TribehausEvent[];
			if (!page?.length) break;

			events.push(...page);
			console.error(`  offset ${offset} — ${events.length} events so far`);
			if (page.length < PAGE_SIZE) break;

			offset += PAGE_SIZE;
			await sleep(100);
		}

		return events;
	}

	private async eventToScrapedEvent(event: TribehausEvent): Promise<ScrapedEvent | undefined> {
		const name = this.extractNameFromEvent(event);
		if (!name) {
			console.error(`Skipping event ${event.id} due to missing name.`);
			return undefined;
		}

		const startAt = this.extractStartAtFromEvent(event);
		if (!startAt) {
			console.error(`Skipping event ${event.id} (${name}) due to missing start date.`);
			return undefined;
		}

		const address = this.extractAddressFromEvent(event);
		const latitude = typeof event.lat === `number` ? event.lat : null;
		const longitude = typeof event.lng === `number` ? event.lng : null;

		let timezone: string | null = event.country_code === `DE` ? DEFAULT_TIMEZONE : null;
		if ((!latitude || !longitude || !timezone) && address?.length) {
			try {
				const geocoded = await geocodeAddressCached({
					addressLines: address,
					apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
				});
				timezone = timezone ?? geocoded?.timezone ?? null;
			} catch (error) {
				console.error(`Geocoding failed for ${event.id}:`, error);
			}
		}
		timezone = timezone ?? DEFAULT_TIMEZONE;

		return {
			name,
			startAt,
			endAt: this.extractEndAtFromEvent(event),
			address,
			price: this.extractPriceFromEvent(event),
			priceIsHtml: false,
			description: this.extractDescriptionFromEvent(event),
			imageUrls: this.extractImageUrlsFromEvent(event),
			host: this.extractHostFromEvent(event),
			hostLink: this.extractHostLinkFromEvent(event),
			contact: this.extractContactFromEvent(event),
			latitude,
			longitude,
			timezone,
			tags: this.extractTagsFromEvent(event),
			sourceUrl: this.buildEventUrl(event),
			source: `tribehaus`,
		} satisfies ScrapedEvent;
	}

	private extractNameFromEvent(event: TribehausEvent): string | undefined {
		const title = event.title?.trim();
		return title || undefined;
	}

	private extractStartAtFromEvent(event: TribehausEvent): string | undefined {
		return this.toIsoDateTime({
			date: event.start_date,
			time: event.start_time,
		});
	}

	private extractEndAtFromEvent(event: TribehausEvent): string | undefined {
		const endDate = event.end_date || event.start_date;
		const endTime = event.end_time;
		if (!endDate || !endTime) return undefined;
		return this.toIsoDateTime({ date: endDate, time: endTime });
	}

	private extractAddressFromEvent(event: TribehausEvent): string[] {
		const parts: string[] = [];
		if (event.street?.trim()) parts.push(event.street.trim());

		const cityLine = [event.zip_code?.trim(), event.city?.trim()].filter(Boolean).join(` `);
		if (cityLine) parts.push(cityLine);

		if (event.country_code?.trim() && event.country_code !== `DE`) {
			parts.push(event.country_code.trim());
		}

		if (parts?.length) return parts;

		const raw = event.raw_address?.trim() || event.address?.trim();
		if (!raw) return [];
		return raw.split(`,`).map((part) => part.trim()).filter(Boolean);
	}

	private extractPriceFromEvent(event: TribehausEvent): string | undefined {
		const priceType = event.price_type === `fixed` || event.price_type === `donation` || event.price_type === `free`
			? event.price_type
			: `free`;

		if (priceType === `free`) return `Kostenlos`;

		const amount = event.price;
		if (amount == null || Number.isNaN(Number(amount))) {
			return priceType === `donation` ? `Spendenbasis` : undefined;
		}

		const formatted = formatEuro(Number(amount));
		if (priceType === `donation`) return `Spende ab ${formatted}`;
		return formatted;
	}

	private extractDescriptionFromEvent(event: TribehausEvent): string | undefined {
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

	private extractImageUrlsFromEvent(event: TribehausEvent): string[] {
		const urls: string[] = [];
		if (event.image_url?.trim()) urls.push(event.image_url.trim());
		for (const url of event.gallery ?? []) {
			if (!url?.trim()) continue;
			if (urls.includes(url.trim())) continue;
			urls.push(url.trim());
		}
		return urls;
	}

	private extractHostFromEvent(event: TribehausEvent): string | undefined {
		const creatorName = event.creator_profiles?.display_name?.trim();
		if (creatorName) return creatorName;

		const hostName = event.host_name?.trim();
		if (!hostName) return undefined;
		if (hostName.toLowerCase() === `me`) return undefined;
		return hostName;
	}

	private extractHostLinkFromEvent(event: TribehausEvent): string | undefined {
		const profile = event.creator_profiles;
		if (!profile?.id) return undefined;
		const slug = profile.slug?.trim() || `creator`;
		return `${SITE_BASE}/creator/${slugify(slug)}-${profile.id}`;
	}

	private extractContactFromEvent(event: TribehausEvent): string[] {
		const contacts: string[] = [];
		if (event.ticket_link?.trim()) contacts.push(event.ticket_link.trim());
		if (event.creator_profiles?.website?.trim()) contacts.push(event.creator_profiles.website.trim());
		return [...new Set(contacts)];
	}

	private extractTagsFromEvent(event: TribehausEvent): string[] {
		const tags = new Set<string>();
		for (const category of event.categories ?? []) {
			if (typeof category !== `string`) continue;
			const trimmed = category.trim();
			if (trimmed) tags.add(trimmed);
		}
		for (const tag of event.tags ?? []) {
			if (typeof tag !== `string`) continue;
			const trimmed = tag.trim();
			if (trimmed) tags.add(trimmed);
		}
		return [...tags];
	}

	private buildEventUrl(event: TribehausEvent): string {
		const slug = event.slug?.trim() || slugify(event.title || `tribehaus`);
		return `${SITE_BASE}/events/${slug}-${event.id}`;
	}

	private toIsoDateTime(args: { date: string | null | undefined; time: string | null | undefined }): string | undefined {
		const { date, time } = args;
		if (!date) return undefined;

		const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!dateMatch) return undefined;

		const year = Number(dateMatch[1]);
		const month = Number(dateMatch[2]);
		const day = Number(dateMatch[3]);

		let hour = 0;
		let minute = 0;
		if (time) {
			const timeMatch = time.match(/^(\d{2}):(\d{2})/);
			if (timeMatch) {
				hour = Number(timeMatch[1]);
				minute = Number(timeMatch[2]);
			}
		}

		return dateToIsoStr(year, month, day, hour, minute, DEFAULT_TIMEZONE, false);
	}
}

function formatEuro(amount: number) {
	const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2).replace(`.`, `,`);
	return `${value}€`;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function slugify(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/ä/g, `ae`)
		.replace(/ö/g, `oe`)
		.replace(/ü/g, `ue`)
		.replace(/ß/g, `ss`)
		.replace(/[^a-z0-9]+/g, `-`)
		.replace(/^-+|-+$/g, ``)
		.replace(/-+/g, `-`) || `tribehaus`;
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

type TribehausCreatorProfile = {
	id: string;
	slug?: string | null;
	display_name?: string | null;
	website?: string | null;
};

type TribehausEvent = {
	id: string;
	title?: string | null;
	slug?: string | null;
	description?: string | null;
	host_name?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	start_time?: string | null;
	end_time?: string | null;
	raw_address?: string | null;
	address?: string | null;
	city?: string | null;
	street?: string | null;
	zip_code?: string | null;
	country_code?: string | null;
	lat?: number | null;
	lng?: number | null;
	price?: number | null;
	price_type?: string | null;
	categories?: string[] | null;
	tags?: string[] | null;
	image_url?: string | null;
	gallery?: string[] | null;
	ticket_link?: string | null;
	status?: string | null;
	creator_profiles?: TribehausCreatorProfile | null;
};
