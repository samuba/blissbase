import adapter from "@sveltejs/adapter-vercel";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { withPwa } from "@vite-pwa/sveltekit";
import tailwindcss from "@tailwindcss/vite";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import posthog from "@posthog/rollup-plugin";
import { varlockVitePlugin } from "@varlock/vite-integration";
import { defineConfig } from "vite";
import { wuchale } from "wuchale/vite";

const isE2e = process.env.E2E_TEST === "true";

export const svelteKitConfig = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		experimental: {
			async: true,
		},
		warningFilter: (warning: { code: string }) => {
			if (
				warning.code === `a11y_no_noninteractive_element_interactions` ||
				warning.code === `a11y_click_events_have_key_events` ||
				warning.code === `a11y_no_static_element_interactions` ||
				warning.code === `element_invalid_self_closing_tag` ||
				warning.code === `no_navigation_without_resolve` // cuz clashes with routes.profile() pattern
			) {
				return false;
			}
			return true;
		},
	},
	outDir: process.env.SVELTEKIT_OUTDIR || `.svelte-kit`,
	serviceWorker: {
		register: false,
	},
	adapter: adapter({
		runtime: `nodejs24.x`,
		regions: [`fra1`],
	}),
	// Kit 3 defaults to HTML <link rel=modulepreload>; restore Kit 2 SSR Link-header delivery (Vercel-safe).
	output: {
		linkHeaderPreload: true,
	},
	version: {
		pollInterval: 60_000 * 1,
	},
	experimental: {
		remoteFunctions: true,
		forkPreloads: false,
	},
	inspector: true,
};

const pwaOptions = {
	registerType: "autoUpdate" as const,
	injectRegister: false as const,
	kit: {
		includeVersionFile: true,
	},
	// Kit 3 remote `prerender()` writes extensionless payloads under prerendered/data — not html/json pages.
	// Default client glob already precaches static icons; includeAssets double-hashed binaries and broke /sw.js.
	// Explicit null disables Kit's default navigateFallback ("./"), which isn't in the precache.
	generateSW: {
		globStrict: false,
		navigateFallback: null,
	},
	devOptions: {
		enabled: !isE2e,
	},
	manifest: {
		name: "Blissbase",
		short_name: "Blissbase",
		description: "Find conscious events near you.",
		theme_color: "#efeae7",
		background_color: "#efeae7",
		start_url: "/",
		scope: "/",
		display_override: ["window-controls-overlay" as const],
		icons: [
			{
				src: "/pwa-192x192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any" as const,
			},
			{
				src: "/pwa-512x512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any" as const,
			},
			{
				src: "/pwa-192-maskable.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "maskable" as const,
			},
			{
				src: "/pwa-512-maskable.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable" as const,
			},
		],
	},
};

export default defineConfig(() => ({
	plugins: [
		// Vercel has no filesystem KeePass — use resolved-env so build-time process env is baked for SSR.
		varlockVitePlugin({ ssrInjectMode: process.env.VERCEL ? `resolved-env` : `auto-load` }),
		tailwindcss(),
		wuchale(),
		enhancedImages(),
		withPwa(svelteKitConfig, pwaOptions),
		process.env.VERCEL
			? posthog({
					personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY!, // Personal API Key
					projectId: process.env.POSTHOG_PROJECT_ID, // Project ID
					host: "https://eu.i.posthog.com", // (optional) defaults to https://us.i.posthog.com
					sourcemaps: {
						enabled: true,
						releaseVersion: process.env.VERCEL_GIT_COMMIT_SHA,
					},
				})
			: undefined,
	],
	...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
	server: {
		allowedHosts: ["localdev.soulspots.app", "localhost", "127.0.0.1", "blissbase.app", "blissbase.vercel.app"],
		...(isE2e
			? {
					hmr: false,
					watch: null,
					warmup: {
						clientFiles: [
							"./src/routes/+layout.svelte",
							"./src/routes/+page.svelte",
							"./src/routes/offerings/+page.svelte",
							"./src/routes/EventDetailsDialog.svelte",
						],
						ssrFiles: [
							"./src/routes/+layout.svelte",
							"./src/routes/+layout.ts",
							"./src/routes/+page.svelte",
							"./src/routes/offerings/+page.svelte",
							"./src/routes/offerings/+page.ts",
							"./src/routes/offerings/+page.server.ts",
						],
					},
				}
			: {}),
	},
	optimizeDeps: {
		// jSquash WASM fails under Vite's dependency optimizer (Invalid URL / wasm fetch).
		exclude: ["@jsquash/webp"],
	},
}));
