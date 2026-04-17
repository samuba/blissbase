import { publicProfileFormSchema } from '$lib/rpc/profile.common';
import {
} from '$lib/server/profile';
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
});