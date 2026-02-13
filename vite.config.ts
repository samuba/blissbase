import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite'
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit'
import { wuchale } from '@wuchale/vite-plugin'
import { enhancedImages } from '@sveltejs/enhanced-img';
import { resolve } from 'path';

const isE2E = process.env.E2E_TEST === 'true';

export default defineConfig({
	plugins: [
		tailwindcss(),
		wuchale(),
		enhancedImages(),
		sveltekit(),
		Icons({ compiler: 'svelte', }),
		SvelteKitPWA({
			includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'logo.svg'],
			registerType: 'autoUpdate',
			injectRegister: false,
			kit: {
				includeVersionFile: true,
			},
			devOptions: {
				enabled: true
			},
			manifest: {
				name: 'Blissbase',
				short_name: 'Blissbase',
				description: 'Achtsame Events in deiner Nähe',
				theme_color: '#efeae7',
				background_color: '#efeae7',
				display_override: ['window-controls-overlay'],
				icons: [
					{
						src: 'pwa-192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: 'pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png'
					},
					{
						src: 'pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			}
		}),
		// E2E mode: replace db module with PGlite version
		isE2E && {
			name: 'e2e-db-replacement',
			enforce: 'pre',
			resolveId(id) {
				if (id === '$lib/server/db' || id.endsWith('/src/lib/server/db')) {
					return resolve('./src/lib/server/db.e2e.ts');
				}
			}
		}
	].filter(Boolean),
	resolve: {
		alias: isE2E ? {
			'$lib/server/db': resolve('./src/lib/server/db.e2e.ts')
		} : {}
	},
	server: {
		allowedHosts: ['localdev.soulspots.app', 'localhost', '127.0.0.1', 'blissbase.app', 'blissbase.vercel.app']
	}
});
