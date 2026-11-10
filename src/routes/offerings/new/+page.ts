import { noindexPageMetaTags } from "#lib/common.ts";
import { getMyPublicProfile } from "#lib/rpc/profile.remote.ts";
import type { PageLoad } from "./$types";

export const load = (async ({ parent }) => {
	const { userId } = await parent();
	return {
		profile: userId ? await getMyPublicProfile() : null,
		pageMetaTags: noindexPageMetaTags,
	};
}) satisfies PageLoad;
