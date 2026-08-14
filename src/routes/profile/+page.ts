import { getUserSession } from "$lib/rpc/auth.remote";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const [myPublic, session] = await Promise.all([
		getMyPublicProfile(),
		getUserSession(),
	]);

	return {
		myPublic,
		session,
	};
}) satisfies PageLoad;
