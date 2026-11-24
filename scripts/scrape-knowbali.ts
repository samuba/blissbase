/**
 * Scrapes KnowBali (com.knowbali.know_bali) via public Cloud Firestore.
 * Distinct from Knowmads Bali. Events live as `listings` with category `Events`.
 *
 * Usage:
 *   bun run scripts/scrape-knowbali.ts
 *   bun run scripts/scrape-knowbali.ts --limit 10
 */
import type { ScrapedEvent } from '../src/lib/types.ts';
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	dateToIsoStr,
	sleep,
	superTrim,
} from './common.ts';
import { geocodeAddressCached } from '../src/lib/server/google.script.ts';

const SITE_BASE = `https://baliconnect-3a159.web.app`;
const PROJECT_ID = `baliconnect-3a159`;
/** Public Firebase web API key from `__/firebase/init.json` (not a secret). */
const FIREBASE_API_KEY = `AIzaSyD05Fa5Sxlt88-S6ffgzRk7wJ42ef2S5CE`;
const FIRESTORE_RUN_QUERY = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
const SOURCE = `knowbali` as const;
const TIMEZONE = `Asia/Makassar` as const;
const PAGE_SIZE = 100;
const LISTING_CATEGORY = `Events`;

/** Rough Bali mainland + islands bbox; reject junk pins (sample had Australia). */
const BALI_LAT = { min: -9.2, max: -8.0 };
const BALI_LNG = { min: 114.3, max: 115.8 };

const RUNNER_FLAGS = new Set([
	`--clean`,
	`--dry-run`,
	`--write-baseline`,
	`--exclude`,
	`--log-dir`,
]);

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(limit?: number): Promise<ScrapedEvent[]> {
		const resolvedLimit = limit ?? parseCliArgs().limit;
		console.error(
			`Fetching KnowBali Events listings via Firestore${resolvedLimit ? ` (limit ${resolvedLimit})` : ``}...`,
		);

		let listings: KnowBaliListing[];
		try {
			listings = await fetchEventListings({ limit: resolvedLimit });
		} catch (error) {
			console.error(`Failed to fetch KnowBali listings:`, error);
			return [];
		}
		console.error(`Loaded ${listings.length} Events listings. Mapping...`);

		const events: ScrapedEvent[] = [];
		for (const listing of listings) {
			try {
				const event = await mapListingToScrapedEvent(listing);
				if (event) events.push(event);
			} catch (error) {
				console.error(`Failed to process listing ${listing.id}:`, error);
			}
		}

		console.error(`--- Scraping finished. Total events collected: ${events.length} ---`);
		return events;
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
}

async function fetchEventListings({ limit }: { limit?: number }): Promise<KnowBaliListing[]> {
	const listings: KnowBaliListing[] = [];
	let offsetDocs = 0;

	while (true) {
		const pageLimit = limit != null ? Math.min(PAGE_SIZE, limit - listings.length) : PAGE_SIZE;
		if (pageLimit <= 0) break;

		const body = {
			structuredQuery: {
				from: [{ collectionId: `listings` }],
				where: {
					compositeFilter: {
						op: `AND`,
						filters: [
							{
								fieldFilter: {
									field: { fieldPath: `category` },
									op: `EQUAL`,
									value: { stringValue: LISTING_CATEGORY },
								},
							},
							{
								fieldFilter: {
									field: { fieldPath: `status` },
									op: `EQUAL`,
									value: { stringValue: `active` },
								},
							},
						],
					},
				},
				limit: pageLimit,
				offset: offsetDocs,
			},
		};

		const res = await fetch(FIRESTORE_RUN_QUERY, {
			method: `POST`,
			headers: { 'Content-Type': `application/json`, Accept: `application/json` },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`KnowBali Firestore query failed: ${res.status} ${await res.text()}`);
		}

		const rows = (await res.json()) as FirestoreRunQueryRow[];
		const page = rows
			.map((row) => mapFirestoreDocument(row.document))
			.filter((x): x is KnowBaliListing => !!x);

		if (!page?.length) break;

		listings.push(...page);
		console.error(`  offset ${offsetDocs} — ${listings.length} listings so far`);
		if (page.length < pageLimit) break;
		if (limit != null && listings.length >= limit) break;

		offsetDocs += page.length;
		await sleep(100);
	}

	return limit != null ? listings.slice(0, limit) : listings;
}

async function mapListingToScrapedEvent(listing: KnowBaliListing): Promise<ScrapedEvent | undefined> {
	const name = getName(listing);
	if (!name) {
		console.error(`Skipping listing ${listing.id} due to missing name.`);
		return undefined;
	}

	const startAt = getStartAt(listing);
	if (!startAt) {
		console.error(`Skipping listing ${listing.id} (${name}) due to missing eventDate.`);
		return undefined;
	}

	const address = getAddress(listing);
	let { latitude, longitude } = getCoordinates(listing);

	let timezone: string | null = TIMEZONE;
	if ((latitude == null || longitude == null) && address?.length) {
		try {
			const geocoded = await geocodeAddressCached({
				addressLines: address,
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
			});
			latitude = latitude ?? geocoded?.lat ?? null;
			longitude = longitude ?? geocoded?.lng ?? null;
			timezone = geocoded?.timezone ?? timezone;
		} catch (error) {
			console.error(`Geocoding failed for ${listing.id}:`, error);
		}
	}

	return {
		name,
		startAt,
		endAt: getEndAt(listing),
		timezone,
		address,
		price: getPrice(listing),
		priceIsHtml: false,
		description: getDescription(listing),
		imageUrls: getImageUrls(listing),
		host: getHost(listing),
		hostLink: getHostLink(listing),
		contact: getContact(listing),
		latitude,
		longitude,
		tags: getTags(listing),
		sourceUrl: getSourceUrl(listing),
		source: SOURCE,
	} satisfies ScrapedEvent;
}

function getName(listing: KnowBaliListing) {
	return superTrim(listing.title) || undefined;
}

function getStartAt(listing: KnowBaliListing) {
	const raw = superTrim(listing.eventDate);
	if (!raw) return undefined;
	const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	// Date-only midnight UTC from Firestore — interpret as Bali calendar day.
	return dateToIsoStr(year, month, day, 0, 0, TIMEZONE, false);
}

function getEndAt(_listing: KnowBaliListing) {
	return undefined;
}

function getAddress(listing: KnowBaliListing) {
	const area = superTrim(listing.area);
	if (!area) return [`Bali`, `Indonesia`];
	return [`${area}, Bali`, `Indonesia`];
}

function getPrice(listing: KnowBaliListing) {
	return superTrim(listing.eventPrice) || undefined;
}

function getDescription(listing: KnowBaliListing) {
	const raw = superTrim(listing.description);
	if (!raw) return undefined;
	const html = raw
		.split(/\r?\n+/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => `<p>${escapeHtml(line)}</p>`)
		.join(``);
	return cleanProseHtml(html) || undefined;
}

function getImageUrls(listing: KnowBaliListing) {
	const urls: string[] = [];
	const cover = superTrim(listing.imageUrl);
	if (cover) urls.push(cover);
	for (const photo of listing.photos ?? []) {
		const url = superTrim(photo?.url);
		if (!url) continue;
		if (urls.includes(url)) continue;
		urls.push(url);
	}
	return urls;
}

function getHost(listing: KnowBaliListing) {
	return superTrim(listing.ownerName) || undefined;
}

function getHostLink(_listing: KnowBaliListing) {
	return undefined;
}

function getContact(listing: KnowBaliListing) {
	const contacts: string[] = [];
	const whatsapp = toWhatsappUrl(listing.whatsAppNumber);
	if (whatsapp) contacts.push(whatsapp);
	return contacts;
}

function getTags(listing: KnowBaliListing) {
	const tags = new Set<string>();
	for (const value of [listing.category, listing.eventType, ...(listing.eventIncludes ?? [])]) {
		const trimmed = superTrim(value);
		if (trimmed) tags.add(trimmed);
	}
	return [...tags];
}

function getSourceUrl(listing: KnowBaliListing) {
	return `${SITE_BASE}/listing/${listing.id}`;
}

function getCoordinates(listing: KnowBaliListing) {
	const parsed = parseMapsCoordinates(listing.locationUrl);
	if (!parsed) return { latitude: null, longitude: null };
	if (!isInBali({ lat: parsed.lat, lng: parsed.lng })) {
		console.error(
			`Ignoring out-of-Bali coordinates for ${listing.id}: ${parsed.lat},${parsed.lng}`,
		);
		return { latitude: null, longitude: null };
	}
	return { latitude: parsed.lat, longitude: parsed.lng };
}

function mapFirestoreDocument(doc: FirestoreDocument | undefined): KnowBaliListing | undefined {
	if (!doc?.name || !doc.fields) return undefined;
	const id = doc.name.split(`/`).pop();
	if (!id) return undefined;
	const f = doc.fields;
	return {
		id,
		title: stringField(f.title),
		description: stringField(f.description),
		area: stringField(f.area),
		category: stringField(f.category),
		status: stringField(f.status),
		imageUrl: stringField(f.imageUrl),
		locationUrl: stringField(f.locationUrl),
		ownerName: stringField(f.ownerName),
		whatsAppNumber: stringField(f.whatsAppNumber),
		eventDate: timestampOrStringField(f.eventDate),
		eventDateType: stringField(f.eventDateType),
		eventDuration: stringField(f.eventDuration),
		eventPrice: stringField(f.eventPrice),
		eventType: stringField(f.eventType),
		eventIncludes: stringArrayField(f.eventIncludes),
		photos: photoArrayField(f.photos),
	};
}

function stringField(node: FirestoreValue | undefined) {
	return node?.stringValue ?? null;
}

function timestampOrStringField(node: FirestoreValue | undefined) {
	return node?.timestampValue ?? node?.stringValue ?? null;
}

function stringArrayField(node: FirestoreValue | undefined) {
	const values = node?.arrayValue?.values;
	if (!values?.length) return null;
	const out: string[] = [];
	for (const value of values) {
		const s = value.stringValue;
		if (s) out.push(s);
	}
	return out?.length ? out : null;
}

function photoArrayField(node: FirestoreValue | undefined) {
	const values = node?.arrayValue?.values;
	if (!values?.length) return null;
	const out: { url: string | null }[] = [];
	for (const value of values) {
		const fields = value.mapValue?.fields;
		out.push({ url: stringField(fields?.url) });
	}
	return out?.length ? out : null;
}

function parseMapsCoordinates(locationUrl: string | null | undefined) {
	const raw = superTrim(locationUrl);
	if (!raw) return undefined;
	const match = raw.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
	if (!match) return undefined;
	const lat = Number(match[1]);
	const lng = Number(match[2]);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
	return { lat, lng };
}

function isInBali({ lat, lng }: { lat: number; lng: number }) {
	return lat >= BALI_LAT.min && lat <= BALI_LAT.max && lng >= BALI_LNG.min && lng <= BALI_LNG.max;
}

function toWhatsappUrl(raw: string | null | undefined) {
	const value = superTrim(raw);
	if (!value) return undefined;
	if (/^https?:\/\/(www\.)?(wa\.me|api\.whatsapp\.com)\//i.test(value)) return value;
	const digits = value.replace(/\D/g, ``);
	if (!digits?.length) return undefined;
	return `https://wa.me/${digits}`;
}

function escapeHtml(text: string) {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

function parseCliArgs() {
	const args = process.argv.slice(2).filter((arg) => {
		if (RUNNER_FLAGS.has(arg)) return false;
		if (arg.startsWith(`--exclude=`)) return false;
		if (arg.startsWith(`--log-dir=`)) return false;
		return true;
	});
	let limit: number | undefined;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === `--limit`) {
			const next = args[i + 1];
			if (next && /^\d+$/.test(next)) {
				limit = Number(next);
				i++;
			}
			continue;
		}
		if (arg.startsWith(`--limit=`)) {
			const value = arg.slice(`--limit=`.length);
			if (/^\d+$/.test(value)) limit = Number(value);
		}
	}
	return { limit };
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

type KnowBaliListing = {
	id: string;
	title: string | null;
	description: string | null;
	area: string | null;
	category: string | null;
	status: string | null;
	imageUrl: string | null;
	locationUrl: string | null;
	ownerName: string | null;
	whatsAppNumber: string | null;
	eventDate: string | null;
	eventDateType: string | null;
	eventDuration: string | null;
	eventPrice: string | null;
	eventType: string | null;
	eventIncludes: string[] | null;
	photos: { url: string | null }[] | null;
};

type FirestoreValue = {
	stringValue?: string;
	timestampValue?: string;
	arrayValue?: { values?: FirestoreValue[] };
	mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
	name?: string;
	fields?: Record<string, FirestoreValue>;
};

type FirestoreRunQueryRow = {
	document?: FirestoreDocument;
};
