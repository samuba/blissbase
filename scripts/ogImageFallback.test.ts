import { describe, expect, it } from "vitest";
import { collectWebsiteUrls, extractOgImageUrlFromHtml } from "./ogImageFallback";

describe(`collectWebsiteUrls`, () => {
	it(`prefers the extracted source URL and skips messenger and maps links`, () => {
		const urls = collectWebsiteUrls({
			sourceUrl: `https://example.com/event`,
			texts: [
				`Join us https://t.me/foo https://wa.me/49123 https://maps.google.com/?q=Berlin and https://other.test/page.`,
			],
		});

		expect(urls).toEqual([`https://example.com/event`, `https://other.test/page`]);
	});

	it(`extracts hrefs from html descriptions`, () => {
		const urls = collectWebsiteUrls({
			sourceUrl: undefined,
			texts: [`More: <a href="https://studio.test/workshop">studio.test</a>`],
		});

		expect(urls).toEqual([`https://studio.test/workshop`]);
	});

	it(`accepts www URLs without a scheme`, () => {
		const urls = collectWebsiteUrls({
			sourceUrl: `www.example.com/retreat`,
			texts: [],
		});

		expect(urls).toEqual([`https://www.example.com/retreat`]);
	});
});

describe(`extractOgImageUrlFromHtml`, () => {
	it(`returns an absolute og:image URL`, () => {
		const imageUrl = extractOgImageUrlFromHtml({
			html: `<meta property="og:image" content="/hero.jpg">`,
			pageUrl: `https://example.com/event`,
		});

		expect(imageUrl).toBe(`https://example.com/hero.jpg`);
	});

	it(`falls back to twitter:image when og:image is missing`, () => {
		const imageUrl = extractOgImageUrlFromHtml({
			html: `<meta name="twitter:image" content="https://cdn.example.com/card.webp">`,
			pageUrl: `https://example.com/event`,
		});

		expect(imageUrl).toBe(`https://cdn.example.com/card.webp`);
	});

	it(`returns undefined when no social image is present`, () => {
		const imageUrl = extractOgImageUrlFromHtml({
			html: `<title>Event</title>`,
			pageUrl: `https://example.com/event`,
		});

		expect(imageUrl).toBeUndefined();
	});
});
