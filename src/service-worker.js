// Basic service worker that doesn't cache anything
self.addEventListener('install', (event) => {
	// Skip waiting to activate the service worker immediately
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	// Claim all clients to ensure the service worker controls all pages
	event.waitUntil(self.clients.claim());
});
