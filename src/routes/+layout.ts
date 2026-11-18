import type { MetaTagsProps } from "svelte-meta-tags";
import { browser, dev } from "$app/env";
import { createBrowserClient, createServerClient, isBrowser } from "@supabase/ssr";
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from "$app/env/public";
import type { LayoutLoad } from "./$types";
import { user } from "#lib/user.svelte.ts";
import { syncPosthogIdentity } from "#lib/posthog.ts";

import { loadLocale } from "wuchale/load-utils";
// so that the loaders are registered, only here, not required in nested ones (below)
import "../locales/main.loader.svelte.js";
import "../locales/js.loader.js";
import { localeStore } from "../locales/localeStore.svelte";
import { resolveLocale } from "../locales/resolveLocale";

export const load: LayoutLoad = async ({ url, data: { jwtClaims, cookies, userId, isAdminSession }, depends, fetch }) => {
	// Declare a dependency so the layout can be invalidated, for example, on session refresh.
	depends("supabase:auth");

	const supabase = isBrowser()
		? createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
				global: { fetch },
			})
		: createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
				global: { fetch },
				cookies: {
					getAll() {
						return cookies;
					},
				},
			});

	if (browser) {
		const locale = resolveLocale({
			cookieLocale: cookies.find((x) => x.name === "locale")?.value,
			browserLang: navigator.language?.split("-")[0],
		});
		console.log("loading locale", locale);
		await loadLocale(locale);
		localeStore.locale = locale;
	}

	if (browser && !dev && !url.host.endsWith(".vercel.app")) {
		syncPosthogIdentity({
			userId,
			email: jwtClaims?.email,
			displayName: jwtClaims?.user_metadata?.display_name,
			isAdminSession,
		});
	}

	// --- Meta Tags ---
	const baseUrl = new URL(url.pathname, url.origin).href;
	const title = "Blissbase";
	const description = "Find conscious events near you.";
	const faviconUrl = "https://www.blissbase.app/favicon.png?v=2";
	const posterUrl = "https://www.blissbase.app/og-poster.png?v=3";
	const baseMetaTags = Object.freeze({
		title,
		description,
		canonical: baseUrl,
		openGraph: {
			type: "website",
			url: baseUrl,
			locale: "de_DE",
			title,
			description,
			siteName: title,
			images: [
				{
					url: posterUrl,
					alt: "Blissbase",
					width: 1200,
					height: 630,
					secureUrl: posterUrl,
					type: "image/png",
				},
			],
		},
		additionalMetaTags: [{ property: "og:logo", content: faviconUrl }],
	}) satisfies MetaTagsProps;

	user.id = userId;
	user.isAdmin = isAdminSession;

	return {
		baseMetaTags,
		jwtClaims,
		supabase,
		userId,
	};
};
