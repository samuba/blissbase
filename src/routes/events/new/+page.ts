import { noindexPageMetaTags } from "$lib/common";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import type { PageLoad } from "./$types";

export const load = (async ({ parent }) => {
	const { userId } = await parent();
	const profile = userId ? await getMyPublicProfile() : null;
	return { profile, pageMetaTags: noindexPageMetaTags };
}) satisfies PageLoad;
