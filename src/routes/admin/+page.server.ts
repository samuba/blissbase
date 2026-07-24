import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load = (({ locals }) => {
	if (!locals.isAdminSession) {
		error(403, `Admin only`);
	}

	return {};
}) satisfies PageServerLoad;
