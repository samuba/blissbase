import type { MetaTagsProps } from 'svelte-meta-tags';
import type { PageLoad } from './$types';

export const load = (() => {
	return {
		pageMetaTags: {
			title: `Type specimen | Blissbase`,
			robots: `noindex`,
		} satisfies MetaTagsProps,
	};
}) satisfies PageLoad;
