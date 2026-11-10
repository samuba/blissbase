import { getMyPublicProfile } from "#lib/rpc/profile.remote.ts";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const profile = await getMyPublicProfile();
	return { profile };
}) satisfies PageLoad;
