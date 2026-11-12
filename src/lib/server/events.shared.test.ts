import { describe, expect, it } from "vitest";
import { isBlissbaseUrl, normalizeSourceUrl, sanitizeTextForPostgres } from "./events.shared";

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

describe(`sanitizeTextForPostgres`, () => {
	it(`turns a mangled non-breaking space into a normal space`, () => {
		expect(sanitizeTextForPostgres(`about\u0000a0being`)).toBe(`about being`);
		expect(sanitizeTextForPostgres(`Delights\u0000A0is`)).toBe(`Delights is`);
		expect(sanitizeTextForPostgres(`let yourself\u0000a0express\u0000a0it`)).toBe(`let yourself express it`);
		expect(sanitizeTextForPostgres(`🍑\u0000a0WHAT`)).toBe(`🍑 WHAT`);
	});

	it(`drops NUL bytes that are not a mangled non-breaking space`, () => {
		expect(sanitizeTextForPostgres(`a\u0000b`)).toBe(`ab`);
		expect(sanitizeTextForPostgres(`\u0000hello`)).toBe(`hello`);
		expect(sanitizeTextForPostgres(`price \u0000a1`)).toBe(`price a1`);
	});

	it(`strips other control characters and keeps tabs and newlines`, () => {
		expect(sanitizeTextForPostgres(`line\n\tnext\r\n`)).toBe(`line\n\tnext\r\n`);
		expect(sanitizeTextForPostgres(`a\u0001b\u0008c\u000Bd\u007Fe\u0085f`)).toBe(`abcdef`);
	});

	it(`keeps a real non-breaking space`, () => {
		expect(sanitizeTextForPostgres(`about\u00A0being`)).toBe(`about\u00A0being`);
	});
});

describe(`isBlissbaseUrl`, () => {
	it(`detects Blissbase hosts without matching lookalike domains`, () => {
		expect(isBlissbaseUrl(`https://assets.blissbase.app/image.jpg`)).toBe(true);
		expect(isBlissbaseUrl(`https://example.com/blissbase.app/event`)).toBe(false);
		expect(isBlissbaseUrl(`https://notblissbase.app/event`)).toBe(false);
	});
});
