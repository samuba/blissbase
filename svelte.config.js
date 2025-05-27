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
	}
};

export default config;
