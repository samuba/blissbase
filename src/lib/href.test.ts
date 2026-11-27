import { describe, expect, it } from "vitest";
import { ensureAbsoluteHref, rewriteRelativeAnchorHrefs, withBlissbaseUtm } from "./common";

describe(`ensureAbsoluteHref`, () => {
	it(`prefixes https for bare host-like hrefs`, () => {
		expect(ensureAbsoluteHref(`example.com`)).toBe(`https://example.com`);
		expect(ensureAbsoluteHref(`www.example.com/path?q=1`)).toBe(`https://www.example.com/path?q=1`);
	});

	it(`keeps absolute and special schemes`, () => {
		expect(ensureAbsoluteHref(`https://example.com`)).toBe(`https://example.com`);
		expect(ensureAbsoluteHref(`http://example.com`)).toBe(`http://example.com`);
		expect(ensureAbsoluteHref(`mailto:hi@example.com`)).toBe(`mailto:hi@example.com`);
		expect(ensureAbsoluteHref(`tel:+49123`)).toBe(`tel:+49123`);
		expect(ensureAbsoluteHref(`tg://resolve?domain=foo`)).toBe(`tg://resolve?domain=foo`);
	});

	it(`handles protocol-relative and site-relative values`, () => {
		expect(ensureAbsoluteHref(`//cdn.example.com/x`)).toBe(`https://cdn.example.com/x`);
		expect(ensureAbsoluteHref(`/events/foo`)).toBe(`/events/foo`);
		expect(ensureAbsoluteHref(`#section`)).toBe(`#section`);
		expect(ensureAbsoluteHref(`?q=1`)).toBe(`?q=1`);
	});
});

describe(`rewriteRelativeAnchorHrefs`, () => {
	it(`rewrites only bare href attributes`, () => {
		const input = `A <a href="example.com">a</a> B <a href="https://ok.test">b</a> C <a href="mailto:x@y.z">c</a>`;
		expect(rewriteRelativeAnchorHrefs(input)).toBe(
			`A <a href="https://example.com">a</a> B <a href="https://ok.test">b</a> C <a href="mailto:x@y.z">c</a>`,
		);
	});
});

describe(`withBlissbaseUtm`, () => {
	it(`adds utm_source and utm_medium to http(s) website URLs`, () => {
		expect(withBlissbaseUtm(`https://example.com/page`)).toBe(
			`https://example.com/page?utm_source=blissbase&utm_medium=referral`,
		);
		expect(withBlissbaseUtm(`example.com`)).toBe(`https://example.com/?utm_source=blissbase&utm_medium=referral`);
	});

	it(`merges with existing query params and overwrites blissbase utms`, () => {
		expect(withBlissbaseUtm(`https://example.com/page?ref=1&utm_source=other`)).toBe(
			`https://example.com/page?ref=1&utm_source=blissbase&utm_medium=referral`,
		);
	});

	it(`preserves hash fragments`, () => {
		expect(withBlissbaseUtm(`https://example.com/page#signup`)).toBe(
			`https://example.com/page?utm_source=blissbase&utm_medium=referral#signup`,
		);
	});

	it(`skips non-website schemes and messaging hosts`, () => {
		expect(withBlissbaseUtm(`mailto:hi@example.com`)).toBe(`mailto:hi@example.com`);
		expect(withBlissbaseUtm(`tel:+49123`)).toBe(`tel:+49123`);
		expect(withBlissbaseUtm(`tg://resolve?domain=foo`)).toBe(`tg://resolve?domain=foo`);
		expect(withBlissbaseUtm(`https://wa.me/49123`)).toBe(`https://wa.me/49123`);
		expect(withBlissbaseUtm(`https://t.me/blissbase`)).toBe(`https://t.me/blissbase`);
	});
});
