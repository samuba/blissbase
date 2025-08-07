import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		serviceWorker: {
			register: false
		},
		adapter: adapter({
			// vercel does not support nodejs23.x
			runtime: process.env.VERCEL ? 'nodejs22.x' : 'nodejs23.x',
			split: true
		}),
		version: {
			pollInterval: 60_000 * 1
		},
		experimental: {
			remoteFunctions: true
		}
	},
	compilerOptions: {
		warningFilter: (warning) => {
			if (
				warning.code === 'a11y_no_noninteractive_element_interactions' ||
				warning.code === 'a11y_click_events_have_key_events' ||
				warning.code === 'a11y_no_static_element_interactions' ||
				warning.code === 'element_invalid_self_closing_tag'
			) {
				return false;
			}
			return true;
		}
	}
};

export default config;
