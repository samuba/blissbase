/**
 * Origin of this Playwright worker's isolated Vite/PGlite server.
 */
export function e2eOrigin() {
	const port = process.env.PLAYWRIGHT_DEV_PORT || `5174`;
	return process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
}

export function e2eCookieDomain() {
	return new URL(e2eOrigin()).hostname;
}
