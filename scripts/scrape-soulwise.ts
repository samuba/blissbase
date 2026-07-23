/**
 * Scrapes events from soulwise.io via the Sharetribe Marketplace API.
 *
 * Auth: anonymous `client_credentials` token (public-read) — no browser needed.
 * Listings: query published bookable listing types, then expand each into
 * upcoming timeslot occurrences.
 *
 * Usage:
 *   bun run scripts/scrape-soulwise.ts
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
	WebsiteScraperInterface,
	cleanProseHtml,
	sleep,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.script.ts";

const CLIENT_ID = `1e60f06b-2fc0-4aed-84b1-e5bd5be81dbe`;
const API_BASE = `https://flex-api.sharetribe.com/v1`;
const SITE_BASE = `https://soulwise.io`;
const EVENT_LISTING_TYPES = [`instant-booking`, `paylater-booking`, `free-booking`] as const;
const TIMESLOT_DAYS_AHEAD = 90;
const LISTINGS_PER_PAGE = 100;
const TIMESLOT_CONCURRENCY = 8;

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		const allEvents: ScrapedEvent[] = [];

		console.error(`Authenticating with Sharetribe (public-read)...`);
		const token = await this.getAccessToken();

		console.error(`Fetching bookable listings...`);
		const listings = await this.fetchAllListings(token);
		console.error(`Found ${listings.length} listings. Fetching timeslots...`);

		const start = new Date().toISOString();
		const end = new Date(Date.now() + TIMESLOT_DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString();

		for (let i = 0; i < listings.length; i += TIMESLOT_CONCURRENCY) {
			const batch = listings.slice(i, i + TIMESLOT_CONCURRENCY);
			const results = await Promise.all(
				batch.map(async (listing) => {
					try {
						return await this.listingToEvents({ listing, token, start, end });
					} catch (error) {
						console.error(`Failed to process listing ${listing.id} (${listing.attributes.title}):`, error);
						return [] as ScrapedEvent[];
					}
				}),
			);
			for (const events of results) allEvents.push(...events);
			if (i + TIMESLOT_CONCURRENCY < listings.length) await sleep(100);
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

	private async getAccessToken(): Promise<string> {
		const res = await fetch(`${API_BASE}/auth/token`, {
			method: `POST`,
			headers: { "Content-Type": `application/x-www-form-urlencoded` },
			body: `client_id=${CLIENT_ID}&grant_type=client_credentials&scope=public-read`,
		});
		if (!res.ok) throw new Error(`Sharetribe auth failed: ${res.status} ${await res.text()}`);
		const data = (await res.json()) as { access_token: string };
		return data.access_token;
	}

	private async fetchAllListings(token: string): Promise<ListingWithIncludes[]> {
		const listings: ListingWithIncludes[] = [];
		let page = 1;
		let totalPages = 1;

		while (page <= totalPages) {
			const params = new URLSearchParams({
				perPage: String(LISTINGS_PER_PAGE),
				page: String(page),
				pub_listingType: EVENT_LISTING_TYPES.join(`,`),
				include: `images,author`,
				"fields.listing": `title,description,price,geolocation,publicData,availabilityPlan,state`,
				"fields.image": `variants.scaled-large,variants.default`,
				"fields.user": `profile`,
				"limit.images": `5`,
			});

			const res = await fetch(`${API_BASE}/api/listings/query?${params}`, {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: `application/json`,
				},
			});
			if (!res.ok) throw new Error(`Listings query failed: ${res.status} ${await res.text()}`);

			const body = (await res.json()) as ListingsQueryResponse;
			totalPages = body.meta.totalPages;
			const included = body.included ?? [];

			for (const listing of body.data) {
				if (listing.attributes.state !== `published`) continue;
				if (listing.attributes.publicData?.visibility === `private-listing`) continue;
				listings.push({
					...listing,
					author: this.resolveAuthor(listing, included),
					images: this.resolveImages(listing, included),
				});
			}

			console.error(`  page ${page}/${totalPages} — ${listings.length} listings so far`);
			page++;
		}

		return listings;
	}

	private async listingToEvents(args: {
		listing: ListingWithIncludes;
		token: string;
		start: string;
		end: string;
	}): Promise<ScrapedEvent[]> {
		const { listing, token, start, end } = args;
		const category = listing.attributes.publicData?.categoryLevel1?.toLowerCase();
		if (category === `yoga`) return [];

		const timeslots = await this.fetchTimeslots({ listingId: listing.id, token, start, end });
		if (!timeslots?.length) return [];

		const name = this.extractNameFromListing(listing);
		if (!name) return [];

		const description = this.extractDescriptionFromListing(listing);
		const address = this.extractAddressFromListing(listing);
		const price = this.extractPriceFromListing(listing);
		const imageUrls = this.extractImageUrlsFromListing(listing);
		const host = this.extractHostFromListing(listing);
		const hostLink = this.extractHostLinkFromListing(listing);
		const tags = this.extractTagsFromListing(listing);
		const listingUrl = this.buildListingUrl(listing);
		const timezone =
			listing.attributes.availabilityPlan?.timezone ??
			(await this.lookupTimezone(address));

		const latitude = listing.attributes.geolocation?.lat ?? undefined;
		const longitude = listing.attributes.geolocation?.lng ?? undefined;

		const events: ScrapedEvent[] = [];
		for (const slot of timeslots) {
			try {
				const startAt = slot.attributes.start;
				const endAt = slot.attributes.end;
				if (!startAt) continue;

				events.push({
					name,
					description,
					imageUrls,
					startAt,
					endAt,
					address,
					price,
					priceIsHtml: false,
					host,
					hostLink,
					contact: [],
					latitude,
					longitude,
					timezone,
					tags,
					sourceUrl: `${listingUrl}?timeslotStart=${encodeURIComponent(startAt)}&timeslotEnd=${encodeURIComponent(endAt)}`,
					source: `soulwise`,
				} satisfies ScrapedEvent);
			} catch (error) {
				console.error(`Failed to map timeslot for ${listing.id}:`, error);
			}
		}
		return events;
	}

	private async fetchTimeslots(args: {
		listingId: string;
		token: string;
		start: string;
		end: string;
	}): Promise<TimeSlot[] | undefined> {
		const params = new URLSearchParams({
			listingId: args.listingId,
			start: args.start,
			end: args.end,
		});
		const res = await fetch(`${API_BASE}/api/timeslots/query?${params}`, {
			headers: {
				Authorization: `Bearer ${args.token}`,
				Accept: `application/json`,
			},
		});
		if (!res.ok) {
			console.error(`Timeslots query failed for ${args.listingId}: ${res.status}`);
			return undefined;
		}
		const body = (await res.json()) as { data?: TimeSlot[] };
		return body.data;
	}

	private extractNameFromListing(listing: ListingWithIncludes): string | undefined {
		const title = listing.attributes.title?.trim();
		if (!title) return undefined;
		if (title.toLowerCase().includes(`[system]`)) return undefined;
		return title;
	}

	private extractDescriptionFromListing(listing: ListingWithIncludes): string | null {
		const raw = listing.attributes.description?.trim();
		if (!raw) return null;
		const html = raw
			.split(/\n+/)
			.map((line) => `<p>${escapeHtml(line)}</p>`)
			.join(``);
		return cleanProseHtml(html) ?? null;
	}

	private extractAddressFromListing(listing: ListingWithIncludes): string[] {
		const mode = listing.attributes.publicData?.mode;
		if (mode === `online`) return [`Online`];

		const location = listing.attributes.publicData?.location;
		const parts: string[] = [];
		const venueName = location?.name?.trim();
		if (venueName) parts.push(venueName);
		if (location?.building?.trim()) parts.push(location.building.trim());

		const addressParts = location?.address?.split(`,`).map((p) => p.trim()).filter(Boolean) ?? [];
		for (const part of addressParts) {
			if (part === venueName) continue;
			if (/^[A-Z0-9]{4}\+[A-Z0-9]{2,3}$/i.test(part)) continue; // Google Plus Code
			if (/^Kec\./i.test(part)) continue;
			if (/^Kabupaten /i.test(part)) continue;
			parts.push(part);
		}
		return [...new Set(parts)];
	}

	private extractPriceFromListing(listing: ListingWithIncludes): string | null {
		const listingType = listing.attributes.publicData?.listingType;
		const price = listing.attributes.price;

		if (listingType === `free-booking`) {
			if (!price || price.amount <= 1) return `free`;
		}
		if (!price) return null;

		const major = price.amount / 100;
		try {
			return new Intl.NumberFormat(`en`, {
				style: `currency`,
				currency: price.currency,
				maximumFractionDigits: major % 1 === 0 ? 0 : 2,
			}).format(major);
		} catch {
			return `${major} ${price.currency}`;
		}
	}

	private extractImageUrlsFromListing(listing: ListingWithIncludes): string[] {
		const urls: string[] = [];
		for (const image of listing.images ?? []) {
			const variants = image.attributes.variants;
			const url = variants?.[`scaled-large`]?.url ?? variants?.default?.url;
			if (url) urls.push(url);
		}
		return urls;
	}

	private extractHostFromListing(listing: ListingWithIncludes): string | null {
		return listing.author?.attributes.profile.displayName?.trim() || null;
	}

	private extractHostLinkFromListing(listing: ListingWithIncludes): string | null {
		if (!listing.author?.id) return null;
		return `${SITE_BASE}/u/${listing.author.id}`;
	}

	private extractTagsFromListing(listing: ListingWithIncludes): string[] {
		const tags: string[] = [];
		const pd = listing.attributes.publicData;
		if (pd?.categoryLevel1) tags.push(humanizeTag(pd.categoryLevel1));
		if (pd?.mode === `online`) tags.push(`Online`);
		if (pd?.language?.length) {
			for (const lang of pd.language) {
				if (lang.toLowerCase() === `english`) continue;
				tags.push(humanizeTag(lang));
			}
		}
		return [...new Set(tags.filter(Boolean))];
	}

	private buildListingUrl(listing: ListingWithIncludes): string {
		return `${SITE_BASE}/l/${slugify(listing.attributes.title)}/${listing.id}`;
	}

	private resolveAuthor(listing: Listing, included: IncludedResource[]): User | undefined {
		const authorId = listing.relationships?.author?.data?.id;
		if (!authorId) return undefined;
		return included.find((x): x is User => x.type === `user` && x.id === authorId);
	}

	private resolveImages(listing: Listing, included: IncludedResource[]): Image[] {
		const refs = listing.relationships?.images?.data ?? [];
		const images: Image[] = [];
		for (const ref of refs) {
			const image = included.find((x): x is Image => x.type === `image` && x.id === ref.id);
			if (image) images.push(image);
		}
		return images;
	}

	private async lookupTimezone(address: string[]): Promise<string | undefined> {
		if (!address?.length || address[0] === `Online`) return undefined;
		try {
			const result = await geocodeAddressCached({
				addressLines: address,
				apiKey: process.env.GOOGLE_MAPS_API_KEY || ``,
			});
			return result?.timezone;
		} catch (error) {
			console.error(`Timezone lookup failed for ${address.join(`, `)}:`, error);
			return undefined;
		}
	}
}

function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.normalize(`NFKD`)
		.replace(/[\u0300-\u036f]/g, ``)
		.replace(/[^a-z0-9]+/g, `-`)
		.replace(/^-+|-+$/g, ``)
		.slice(0, 80);
	return slug || `listing`;
}

/** camelCase / lowercase → Title Case words, e.g. spiritualGuidance → Spiritual Guidance */
function humanizeTag(tag: string): string {
	return tag
		.replace(/([a-z])([A-Z])/g, `$1 $2`)
		.replace(/[_-]+/g, ` `)
		.trim()
		.split(/\s+/)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(` `);
}

function escapeHtml(text: string): string {
	return text
		.replaceAll(`&`, `&amp;`)
		.replaceAll(`<`, `&lt;`)
		.replaceAll(`>`, `&gt;`)
		.replaceAll(`"`, `&quot;`);
}

if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		console.log(JSON.stringify(await scraper.scrapeWebsite(), null, 2));
	} catch (error) {
		console.error(`Unhandled error in main execution:`, error);
		process.exit(1);
	}
}

type Money = {
	amount: number;
	currency: string;
};

type ListingPublicData = {
	categoryLevel1?: string;
	currency?: string;
	language?: string[];
	listingType?: string;
	location?: {
		address?: string;
		building?: string;
		name?: string;
	};
	mode?: string;
	unitType?: string;
	venueName?: string;
	visibility?: string;
};

type Listing = {
	id: string;
	type: `listing`;
	attributes: {
		title: string;
		description?: string | null;
		price?: Money | null;
		geolocation?: { lat: number; lng: number } | null;
		publicData?: ListingPublicData;
		availabilityPlan?: { type: string; timezone?: string } | null;
		state?: string;
	};
	relationships?: {
		author?: { data?: { id: string; type: `user` } };
		images?: { data?: { id: string; type: `image` }[] };
	};
};

type User = {
	id: string;
	type: `user`;
	attributes: {
		profile: {
			displayName?: string;
			abbreviatedName?: string;
			bio?: string;
		};
	};
};

type Image = {
	id: string;
	type: `image`;
	attributes: {
		variants?: Record<string, { url?: string; width?: number; height?: number }>;
	};
};

type IncludedResource = User | Image;

type ListingWithIncludes = Listing & {
	author?: User;
	images?: Image[];
};

type TimeSlot = {
	id: string;
	type: `timeSlot`;
	attributes: {
		type: string;
		seats?: number;
		start: string;
		end: string;
	};
};

type ListingsQueryResponse = {
	data: Listing[];
	included?: IncludedResource[];
	meta: {
		totalItems: number;
		totalPages: number;
		page: number;
		perPage: number;
	};
};
