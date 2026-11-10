/// <reference types="$app/types/service-worker" />

import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";

const CACHE_NAME = `cache-${version}`;
const ASSETS_TO_CACHE = [...immutable, ...assets];

self.addEventListener(`install`, (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			console.log(`Opened cache`);
			return cache.addAll(ASSETS_TO_CACHE);
		}),
	);
});

self.addEventListener(`activate`, (event) => {
	event.waitUntil(
		caches.keys().then((cacheNames) => {
			return Promise.all(
				cacheNames.map((cacheName) => {
					if (cacheName !== CACHE_NAME) {
						return caches.delete(cacheName);
					}
				}),
			);
		}),
	);
});

self.addEventListener(`fetch`, (event) => {
	event.respondWith(
		caches.match(event.request).then((response) => {
			if (response) {
				return response;
			}
			return fetch(event.request);
		}),
	);
});
