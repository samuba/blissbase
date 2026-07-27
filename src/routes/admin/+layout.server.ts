import { error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { LayoutServerLoad } from './$types';

export const config: Config = {
	// Keep admin SSR/deps out of the shared catchall function
	split: true,
};

export const load = (({ locals }) => {
	if (!locals.isAdminSession) {
		error(403, `Admin only`);
	}

	return {};
}) satisfies LayoutServerLoad;
