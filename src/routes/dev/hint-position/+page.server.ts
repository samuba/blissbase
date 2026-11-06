import { dev } from "$app/environment";
import { E2E_TEST } from "$env/static/private";
import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load = (() => {
	if (!dev || E2E_TEST !== `true`) error(404, `Not found`);
	return { autoDetectedCity: `Berlin, DE` };
}) satisfies PageServerLoad;
