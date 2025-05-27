import tailwindcss from '@tailwindcss/vite';
import Icons from 'unplugin-icons/vite'
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		Icons({ compiler: 'svelte', }),
		VitePWA({
			includeAssets: ['pwa-192x192.png', 'pwa-512x512.png', 'logo.svg'],
			registerType: 'autoUpdate',
			devOptions: {
				enabled: true
			},
			manifest: {
				name: 'Blissbase',
				short_name: 'Blissbase',
				description: 'Hippie Events in deiner Nähe',
				theme_color: '#43ebd3',
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
		})
	],
	server: {
		allowedHosts: ['localdev.soulspots.app', 'localhost', '127.0.0.1']
	}
});
