import { getMyOfferings } from "#lib/rpc/offerings.remote.ts";
import { getMyPublicProfile } from "#lib/rpc/profile.remote.ts";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const [profile, offerings] = await Promise.all([getMyPublicProfile(), getMyOfferings()]);

	return { profile, offerings };
}) satisfies PageLoad;
