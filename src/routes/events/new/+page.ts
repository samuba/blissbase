import { getTags } from "$lib/rpc/TagSelection.remote";
import { getMyPublicProfile } from "$lib/rpc/profile.remote";
import type { PageLoad } from "./$types";

export const load = (async ({ parent }) => {
	const { userId } = await parent();
	const [tags, profile] = await Promise.all([
		getTags(),
		userId ? getMyPublicProfile() : Promise.resolve(null),
	]);
	return { tags, profile };
}) satisfies PageLoad;
