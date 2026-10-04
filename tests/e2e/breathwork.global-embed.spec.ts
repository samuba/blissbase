import { expect, test } from "./helpers/fixtures";
import { createEvent } from "./helpers/seed";

test(`date and city search returns blissbase breathwork events`, async ({ page }) => {
	const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
	const later = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
	await createEvent(page, {
		name: `Atemkreis am Wasser`,
		startAt: soon,
		address: [`Warschauer Str. 1`, `10243 Berlin`],
		latitude: 52.52,
		longitude: 13.405,
		tags: [`Breathwork`],
		imageUrls: [`https://example.com/atem.jpg`],
		slug: `atemkreis-berlin`,
	});
	await createEvent(page, {
		name: `Zweiter Atemkreis`,
		startAt: later,
		address: [`Schönhauser Allee 1`, `10435 Berlin`],
		latitude: 52.53,
		longitude: 13.41,
		tags: [`Breathwork`],
		slug: `zweiter-atemkreis`,
	});
	await createEvent(page, {
		name: `Hafen Atem`,
		startAt: soon,
		address: [`Hafenstraße 1`, `20457 Hamburg`],
		latitude: 53.5511,
		longitude: 9.9937,
		tags: [`Breathwork`],
		slug: `hafen-atem`,
	});
	await createEvent(page, {
		name: `Yoga am See`,
		startAt: soon,
		address: [`Seestraße 1`, `10243 Berlin`],
		latitude: 52.52,
		longitude: 13.4,
		tags: [`Yoga`],
		slug: `yoga-am-see`,
	});

	await page.route(`**/embed-host`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: `text/html; charset=utf-8`,
			body: `<!doctype html><html><body>
				<script location-id="195" initial-limit="1" src="/embed/event-search-snippet.js"></script>
				<div id="app"></div>
			</body></html>`,
		});
	});
	await page.goto(`/embed-host`);

	await expect(page.getByTestId(`breathwork-embed-event`).filter({ hasText: `Atemkreis am Wasser` })).toBeVisible();
	await expect(page.getByText(`Hafen Atem`)).toHaveCount(0);
	await expect(page.getByText(`Yoga am See`)).toHaveCount(0);
	await expect(page.getByTestId(`breathwork-embed-more`)).toBeVisible();
	await page.getByTestId(`breathwork-embed-more`).click();
	await expect(page.getByText(`Zweiter Atemkreis`)).toBeVisible();

	await page.unroute(`**/embed-host`);
	await page.route(`**/embed-host`, async (route) => {
		await route.fulfill({
			status: 200,
			contentType: `text/html; charset=utf-8`,
			body: `<!doctype html><html><body>
				<div id="app"></div>
				<script src="/embed/event-search-snippet.js"></script>
			</body></html>`,
		});
	});
	await page.goto(`/embed-host`);
	await page.getByTestId(`breathwork-embed-city`).selectOption(`197`);
	await page.getByTestId(`breathwork-embed-search`).click();
	await expect(page.getByTestId(`breathwork-embed-empty`)).toHaveText(`Keine Events gefunden`);
});
