import { dev } from "$app/environment";
import { E2E_TEST } from "$env/static/private";
import type { RequestHandler } from "./$types";

export const PUT: RequestHandler = async () => {
	if (E2E_TEST !== `true` || !dev) {
		return new Response(`Only available in E2E mode`, { status: 403 });
	}

	return new Response(null, { status: 200 });
};
