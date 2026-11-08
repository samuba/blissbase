import { noindexPageMetaTags } from "#lib/common.ts";
import { getMyPublicProfile } from "#lib/rpc/profile.remote.ts";
import type { PageLoad } from "./$types";

export const load = (async ({ parent }) => {
	const { userId } = await parent();
	const profile = userId ? await getMyPublicProfile() : null;
	return { profile, pageMetaTags: noindexPageMetaTags };
}) satisfies PageLoad;
