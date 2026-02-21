import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite'
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit'
import { wuchale } from '@wuchale/vite-plugin'
import { enhancedImages } from '@sveltejs/enhanced-img';

export default defineConfig({
	plugins: [
		tailwindcss(),
		wuchale(),
		enhancedImages(),
		sveltekit(),
		Icons({ compiler: 'svelte', }),
		SvelteKitPWA({
			includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'pwa-512-maskable.png', 'logo.svg'],
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
						src: 'pwa-512-maskable.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					},
					{
						src: 'pwa-192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: 'pwa-512x512.png',
						sizes: '512x512',
						type: 'image/png'
					}
				]
			}
		})
	],
	server: {
		allowedHosts: ['localdev.soulspots.app', 'localhost', '127.0.0.1', 'blissbase.app', 'blissbase.vercel.app']
	}
});
