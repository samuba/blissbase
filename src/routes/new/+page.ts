import type { Config } from '@sveltejs/adapter-vercel';
import { redirect } from '@sveltejs/kit';
import { routes } from '$lib/routes';
import type { PageLoad } from './$types';

export const config: Config = {
	split: true
};

export const load: PageLoad = ({ url }) => {
	if (url.searchParams.get(`create`) === `1`) {
		redirect(302, routes.newEvent());
	}
};
