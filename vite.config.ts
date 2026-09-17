import adapter from "@sveltejs/adapter-vercel";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { SvelteKitPWA } from "@vite-pwa/sveltekit";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import posthog from "@posthog/rollup-plugin";
import { defineConfig } from "vite";
import { wuchale } from "wuchale/vite";

const isE2e = process.env.E2E_TEST === "true";

export const svelteKitConfig = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		experimental: {
			async: true,
		},
		warningFilter: (warning) => {
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
	version: {
		pollInterval: 60_000 * 1,
	},
	experimental: {
		remoteFunctions: true,
		forkPreloads: false,
	},
	inspector: true,
} satisfies NonNullable<Parameters<typeof sveltekit>[0]>;

export default defineConfig(() => ({
	plugins: [
		tailwindcss(),
		wuchale(),
		enhancedImages(),
		sveltekit(svelteKitConfig),
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
		SvelteKitPWA({
			includeAssets: ["favicon.ico", "favicon.svg", "favicon.png", "apple-touch-icon.png", "pwa-192x192.png", "pwa-512x512.png", "pwa-512-maskable.png", "pwa-192-maskable.png", "logo.svg"],
			registerType: "autoUpdate",
			injectRegister: false,
			kit: {
				includeVersionFile: true,
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
				display_override: ["window-controls-overlay"],
				icons: [
					{
						src: "/pwa-192x192.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "any",
					},
					{
						src: "/pwa-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "any",
					},
					{
						src: "/pwa-192-maskable.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "maskable",
					},
					{
						src: "/pwa-512-maskable.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
		}),
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
