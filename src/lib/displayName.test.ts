import { describe, expect, it } from "vitest";
import { displayNameForStorage, isProperDisplayName } from "./displayName";

describe(`isProperDisplayName`, () => {
	it(`accepts usernames and display names`, () => {
		expect(isProperDisplayName(`Sam`)).toBe(true);
		expect(isProperDisplayName(`Anna Müller`)).toBe(true);
		expect(isProperDisplayName(`Sam (@sam)`)).toBe(true);
		expect(isProperDisplayName(`@sam`)).toBe(true);
		expect(isProperDisplayName(`Studio 54`)).toBe(true);
		expect(isProperDisplayName(`  The Yoga Barn  `)).toBe(true);
	});

	it(`rejects empty values`, () => {
		expect(isProperDisplayName(null)).toBe(false);
		expect(isProperDisplayName(undefined)).toBe(false);
		expect(isProperDisplayName(``)).toBe(false);
		expect(isProperDisplayName(`   `)).toBe(false);
	});

	it(`rejects WhatsApp JIDs and LIDs`, () => {
		expect(isProperDisplayName(`47382582554768@lid`)).toBe(false);
		expect(isProperDisplayName(`47382582554768@LID`)).toBe(false);
		expect(isProperDisplayName(`123456789@s.whatsapp.net`)).toBe(false);
		expect(isProperDisplayName(`123456789:12@s.whatsapp.net`)).toBe(false);
		expect(isProperDisplayName(`120363000@g.us`)).toBe(false);
		expect(isProperDisplayName(`12345@c.us`)).toBe(false);
		expect(isProperDisplayName(`12345@broadcast`)).toBe(false);
		expect(isProperDisplayName(`12345@newsletter`)).toBe(false);
		expect(isProperDisplayName(`Hosted by 47382582554768@lid`)).toBe(false);
	});

	it(`rejects bare phone numbers and numeric ids`, () => {
		expect(isProperDisplayName(`491701234567`)).toBe(false);
		expect(isProperDisplayName(`+49 170 1234567`)).toBe(false);
		expect(isProperDisplayName(`+49 (170) 123-4567`)).toBe(false);
		expect(isProperDisplayName(`218154725`)).toBe(false);
		expect(isProperDisplayName(`42`)).toBe(false);
	});
});

describe(`displayNameForStorage`, () => {
	it(`returns a trimmed name or null`, () => {
		expect(displayNameForStorage(`  Sam  `)).toBe(`Sam`);
		expect(displayNameForStorage(`  47382582554768@lid  `)).toBeNull();
		expect(displayNameForStorage(`+49 170 1234567`)).toBeNull();
		expect(displayNameForStorage(null)).toBeNull();
	});
});
