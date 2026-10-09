import { describe, expect, it } from 'vitest';
import { ensureAbsoluteHref, rewriteRelativeAnchorHrefs } from './common';

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
			`A <a href="https://example.com">a</a> B <a href="https://ok.test">b</a> C <a href="mailto:x@y.z">c</a>`
		);
	});
});
