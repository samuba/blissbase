import { publicProfileFormSchema } from '$lib/rpc/profile.common';
import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

describe(`publicProfileFormSchema`, () => {
	it(`accepts social links as { type, value } rows`, () => {
		const result = v.safeParse(publicProfileFormSchema, {
			displayName: `Test User`,
			slug: `test-user`,
			bio: ``,
			socialLinks: [
				{ type: `website`, value: `blissbase.app` },
				{ type: `telegram`, value: `@blissbase` }
			],
			profileImageUrl: ``,
			bannerImageUrl: ``
		});

		expect(result.success).toBe(true);
	});

	it(`accepts an empty social links array`, () => {
		const result = v.safeParse(publicProfileFormSchema, {
			displayName: `Test User`,
			socialLinks: [],
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.output.socialLinks).toEqual([]);
	});

	it(`removes social links with empty values`, () => {
		const result = v.safeParse(publicProfileFormSchema, {
			displayName: `Test User`,
			socialLinks: [
				{ type: `instagram`, value: `` },
				{ type: `website`, value: `  ` },
				{ type: `telegram`, value: `@blissbase` },
			],
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.output.socialLinks).toEqual([{ type: `telegram`, value: `blissbase` }]);
	});

	it(`rejects an invalid website social link`, () => {
		const result = v.safeParse(publicProfileFormSchema, {
			displayName: `Test User`,
			socialLinks: [{ type: `website`, value: `not-a-domain` }],
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.issues.some((issue) => issue.message === `Website is not a valid URL`)).toBe(true);
	});

	it(`rejects an invalid telegram social link`, () => {
		const result = v.safeParse(publicProfileFormSchema, {
			displayName: `Test User`,
			socialLinks: [{ type: `telegram`, value: `ab` }],
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.issues.some((issue) => issue.message === `Telegram username is invalid`)).toBe(true);
	});
});