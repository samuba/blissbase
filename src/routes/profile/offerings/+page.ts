import { getMyOfferings } from "$lib/rpc/offerings.remote";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const [profile, offerings] = await Promise.all([
		getMyPublicProfile(),
		getMyOfferings(),
	]);

	return { profile, offerings };
}) satisfies PageLoad;
