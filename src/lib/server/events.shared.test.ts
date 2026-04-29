import { describe, expect, it } from 'vitest';
import { isBlissbaseUrl, normalizeSourceUrl } from './events.shared';

describe(`normalizeSourceUrl`, () => {
	it(`removes Blissbase app links`, () => {
		expect(normalizeSourceUrl(`https://blissbase.app/ecstatic-dance`)).toBeNull();
		expect(normalizeSourceUrl(`https://www.blissbase.app/ecstatic-dance`)).toBeNull();
		expect(normalizeSourceUrl(`blissbase.app/ecstatic-dance`)).toBeNull();
	});

	it(`keeps non-Blissbase source links`, () => {
		expect(normalizeSourceUrl(` https://example.com/event `)).toBe(`https://example.com/event`);
		expect(normalizeSourceUrl(`https://notblissbase.app/event`)).toBe(`https://notblissbase.app/event`);
	});

	it(`normalizes empty values to null`, () => {
		expect(normalizeSourceUrl(undefined)).toBeNull();
		expect(normalizeSourceUrl(null)).toBeNull();
		expect(normalizeSourceUrl(`   `)).toBeNull();
	});
});

describe(`isBlissbaseUrl`, () => {
	it(`detects Blissbase hosts without matching lookalike domains`, () => {
		expect(isBlissbaseUrl(`https://assets.blissbase.app/image.jpg`)).toBe(true);
		expect(isBlissbaseUrl(`https://example.com/blissbase.app/event`)).toBe(false);
		expect(isBlissbaseUrl(`https://notblissbase.app/event`)).toBe(false);
	});
});
