import { dev } from '$app/environment';
import { command } from '$app/server';
import { E2E_TEST } from '$env/static/private';
import { knownTagSlugs } from '$lib/eventCategories';
import { aiSuggestTagSlugs } from '$lib/server/ai';
import * as v from 'valibot';

const suggestEventTagSlugsSchema = v.object({
	name: v.pipe(v.string(), v.maxLength(10_000)),
	description: v.pipe(v.string(), v.maxLength(100_000)),
});

/**
 * Suggests catalog tag slugs from an event title and description.
 * @example
 * await suggestEventTagSlugs({ name: `Ecstatic Dance`, description: `<p>Barefoot dance</p>` })
 */
export const suggestEventTagSlugs = command(suggestEventTagSlugsSchema, async ({ name, description }) => {
	if (E2E_TEST === `true` && dev) return [];

	const tags = await aiSuggestTagSlugs({ name, description });
	return knownTagSlugs(tags);
});
