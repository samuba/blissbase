import { getTags } from "$lib/rpc/TagSelection.remote";
import type { PageLoad } from "./$types";

export const load = (async () => {
	const tags = await getTags();
	return { tags };
}) satisfies PageLoad;
