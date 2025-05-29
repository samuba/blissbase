import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
	preprocess: vitePreprocess(),
	kit: {
		serviceWorker: {
			register: false
		},
		adapter: adapter({
			// vercel does not support nodejs23.x
			runtime: process.env.VERCEL ? 'nodejs22.x' : 'nodejs23.x'
		})
	},
	compilerOptions: {
		warningFilter: (warning) => {
			if (
				warning.code === 'a11y_no_noninteractive_element_interactions' ||
				warning.code === 'a11y_click_events_have_key_events' ||
				warning.code === 'a11y_no_static_element_interactions'
			) {
				return false;
			}
			return true;
		}
	}
};

export default config;
