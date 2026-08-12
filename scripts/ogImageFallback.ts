import * as cheerio from "cheerio";
import { BrowserSession } from "./browserSession.ts";
import { resizeCoverImage } from "../src/lib/imageProcessing.ts";
import * as assets from "../src/lib/assets.ts";
import { and, db, eq, s } from "../src/lib/server/db.script.ts";

const MAX_WEBSITES_TO_TRY = 3;
const TRAILING_URL_PUNCTUATION_REGEX = /[)\]},.!?;:]+$/;
const BARE_URL_REGEX = /https?:\/\/[^\s<>"'`]+/gi;
const SKIPPED_HOSTNAMES = new Set([
	`t.me`,
	`telegram.me`,
	`telegram.org`,
	`wa.me`,
	`whatsapp.com`,
	`api.whatsapp.com`,
	`chat.whatsapp.com`,
	`maps.google.com`,
	`maps.app.goo.gl`,
	`google.com`,
	`docs.google.com`,
]);

/**
 * Uses a website OG image when a messenger event has no photo of its own.
 * @example
 * const imageUrls = await resolveEventImageUrls({ imageUrls: [], slug: `yoga-2024`, sourceUrl: `https://example.com/event`, description: `See https://example.com/event` })
 */
export async function resolveEventImageUrls(args: {
	imageUrls: string[];
	slug: string;
	sourceUrl?: string | null;
	description?: string | null;
}): Promise<string[]> {
	if (args.imageUrls?.length) return args.imageUrls;

	const ogImageUrl = await downloadOgImageFallback({
		slug: args.slug,
		sourceUrl: args.sourceUrl,
		description: args.description,
	});
	if (!ogImageUrl) return args.imageUrls ?? [];
	return [ogImageUrl];
}

/**
 * Visits websites from the announcement and uploads the first OG image that downloads.
 * @example
 * const imageUrl = await downloadOgImageFallback({ slug: `yoga-2024`, sourceUrl: `https://example.com/event`, description: `More: https://example.com/event` })
 */
export async function downloadOgImageFallback(args: {
	slug: string;
	sourceUrl?: string | null;
	description?: string | null;
}): Promise<string | undefined> {
	const websiteUrls = collectWebsiteUrls({
		sourceUrl: args.sourceUrl,
		texts: [args.description],
	}).slice(0, MAX_WEBSITES_TO_TRY);
	if (!websiteUrls?.length) return undefined;

	console.log(`[og-image] No messenger image for ${args.slug}, trying ${websiteUrls.length} website(s)`);

	const session = new BrowserSession();
	try {
		for (const websiteUrl of websiteUrls) {
			try {
				const imageUrl = await downloadOgImageFromWebsite({
					slug: args.slug,
					websiteUrl,
					session,
				});
				if (imageUrl) return imageUrl;
			} catch (error) {
				console.error(`[og-image] Failed OG fallback for ${websiteUrl}:`, error);
			}
		}
	} finally {
		await session.close();
	}

	return undefined;
}

/**
 * Collects http(s) event-page URLs, preferring the extracted source URL.
 * @example
 * collectWebsiteUrls({ sourceUrl: `https://example.com/event`, texts: [`See https://t.me/foo and https://other.test`] })
 */
export function collectWebsiteUrls(args: {
	sourceUrl?: string | null;
	texts: (string | null | undefined)[];
}): string[] {
	const urls: string[] = [];

	const add = (raw: string | undefined | null) => {
		const url = normalizeWebsiteUrl(raw);
		if (!url) return;
		if (isSkippedWebsiteUrl(url)) return;
		if (urls.includes(url.href)) return;
		urls.push(url.href);
	};

	add(args.sourceUrl);
	for (const text of args.texts) {
		if (!text) continue;
		for (const candidate of extractUrlsFromText(text)) add(candidate);
	}

	return urls;
}

/**
 * Reads the first usable Open Graph / Twitter image URL from a page.
 * @example
 * extractOgImageUrlFromHtml({ html: `<meta property="og:image" content="/hero.jpg">`, pageUrl: `https://example.com/event` })
 */
export function extractOgImageUrlFromHtml(args: { html: string; pageUrl: string }): string | undefined {
	const $ = cheerio.load(args.html);
	const candidates = [
		$(`meta[property="og:image"]`).attr(`content`),
		$(`meta[property="og:image:url"]`).attr(`content`),
		$(`meta[property="og:image:secure_url"]`).attr(`content`),
		$(`meta[name="twitter:image"]`).attr(`content`),
		$(`meta[name="twitter:image:src"]`).attr(`content`),
	];

	for (const candidate of candidates) {
		const absolute = toAbsoluteUrl({ href: candidate, pageUrl: args.pageUrl });
		if (!absolute) continue;
		if (absolute.startsWith(`data:`)) continue;
		return absolute;
	}

	return undefined;
}

async function downloadOgImageFromWebsite(args: {
	slug: string;
	websiteUrl: string;
	session: BrowserSession;
}): Promise<string | undefined> {
	const html = await args.session.visit({ url: args.websiteUrl });
	const ogImageUrl = extractOgImageUrlFromHtml({ html, pageUrl: args.websiteUrl });
	if (!ogImageUrl) {
		console.log(`[og-image] No OG image on ${args.websiteUrl}`);
		return undefined;
	}

	const alreadyCachedImage = await db.query.imageCacheMap.findFirst({
		where: and(
			eq(s.imageCacheMap.originalUrl, ogImageUrl),
			eq(s.imageCacheMap.eventSlug, args.slug),
		),
	});
	if (alreadyCachedImage) {
		console.log(`[og-image] Reusing cached OG image for ${args.slug}: ${alreadyCachedImage.url}`);
		return alreadyCachedImage.url;
	}

	const res = await args.session.fetch({
		url: ogImageUrl,
		kind: `image`,
		referer: args.websiteUrl,
	});
	const bytes = Buffer.from(await res.arrayBuffer());
	const { buffer, phash } = await resizeCoverImage(bytes);
	const imageUrl = await assets.uploadEventImage(buffer, args.slug, phash, assets.loadCreds());
	try {
		await db.insert(s.imageCacheMap).values({
			originalUrl: ogImageUrl,
			eventSlug: args.slug,
			url: imageUrl,
		});
	} catch (error) {
		console.error(`[og-image] Failed to cache OG image mapping for ${args.slug}:`, error);
	}
	console.log(`[og-image] Using OG image from ${args.websiteUrl}: ${imageUrl}`);
	return imageUrl;
}

function extractUrlsFromText(text: string): string[] {
	const urls: string[] = [];
	const $ = cheerio.load(text);
	$(`a[href]`).each((_index, element) => {
		const href = $(element).attr(`href`);
		if (href) urls.push(href);
	});

	for (const match of text.matchAll(BARE_URL_REGEX)) {
		urls.push(match[0]);
	}

	return urls;
}

function normalizeWebsiteUrl(raw: string | undefined | null): URL | undefined {
	if (!raw?.trim()) return undefined;

	let candidate = raw.trim().replace(TRAILING_URL_PUNCTUATION_REGEX, ``);
	if (candidate.startsWith(`www.`)) candidate = `https://${candidate}`;

	try {
		const url = new URL(candidate);
		if (url.protocol !== `http:` && url.protocol !== `https:`) return undefined;
		return url;
	} catch {
		return undefined;
	}
}

function isSkippedWebsiteUrl(url: URL): boolean {
	const hostname = url.hostname.toLowerCase().replace(/^www\./, ``);
	if (SKIPPED_HOSTNAMES.has(hostname)) return true;
	if (hostname === `goo.gl` && url.pathname.startsWith(`/maps`)) return true;
	return false;
}

function toAbsoluteUrl(args: { href: string | undefined; pageUrl: string }): string | undefined {
	if (!args.href?.trim()) return undefined;
	try {
		return new URL(args.href.trim(), args.pageUrl).toString();
	} catch {
		return undefined;
	}
}
