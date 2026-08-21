import { noindexPageMetaTags } from "$lib/common";
import type { LayoutLoad } from "./$types";

export const load = (() => {
	return { pageMetaTags: noindexPageMetaTags };
}) satisfies LayoutLoad;
