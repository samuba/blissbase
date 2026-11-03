import { describe, expect, it } from 'vitest';
import { resolveLocale } from './resolveLocale';

describe(`resolveLocale`, () => {
	it(`prefers a valid cookie over the browser language`, () => {
		expect(resolveLocale({ cookieLocale: `en`, browserLang: `de` })).toBe(`en`);
		expect(resolveLocale({ cookieLocale: `de`, browserLang: `en` })).toBe(`de`);
	});

	it(`defaults to de only for German browsers`, () => {
		expect(resolveLocale({ browserLang: `de` })).toBe(`de`);
		expect(resolveLocale({ browserLang: `DE` })).toBe(`de`);
		expect(resolveLocale({ browserLang: `en` })).toBe(`en`);
		expect(resolveLocale({ browserLang: `fr` })).toBe(`en`);
		expect(resolveLocale({})).toBe(`en`);
	});

	it(`ignores invalid cookies`, () => {
		expect(resolveLocale({ cookieLocale: `fr`, browserLang: `de` })).toBe(`de`);
		expect(resolveLocale({ cookieLocale: `fr`, browserLang: `en` })).toBe(`en`);
	});
});
