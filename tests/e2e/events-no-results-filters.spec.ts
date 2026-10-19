import { expect, test } from "./helpers/fixtures";
import { clearTestEvents, createEvents, createMeditationEvent } from "./helpers/seed";
import {
	setEventLocationFilterCookie,
	setGermanLocale,
	waitForClientHydration,
} from "./helpers/offering-test-utils";

const berlin = { lat: 52.52, lng: 13.405 };

test.describe(`events no-results filter controls`, () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestEvents(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test(`shows removable chips and radius select when a filtered search has no results`, async ({
		page,
	}) => {
		await setEventLocationFilterCookie(page, {
			plzCity: `Berlin`,
			distance: `50`,
			lat: berlin.lat,
			lng: berlin.lng,
		});
		await page.goto(`/`);
		await waitForClientHydration(page);

		const empty = page.getByTestId(`events-no-results`);
		await expect(empty).toContainText(`Keine Events gefunden`);
		await expect(page.getByTestId(`events-no-results-location`)).toContainText(`Berlin`);
		await expect(page.getByTestId(`events-no-results-chip-location`)).toHaveCount(0);
		await expect(page.getByTestId(`events-no-results-radius`)).toContainText(
			`Möchtest du den Radius erweitern?`,
		);
		await expect(page.getByTestId(`events-no-results-radius-select`)).toHaveValue(`50`);

		await page.getByTestId(`category-chip-meditation`).click();
		await expect(page.getByTestId(`events-no-results-chip-category-meditation`)).toBeVisible();

		await page.getByTestId(`events-no-results-radius-select`).selectOption(`100`);
		await expect(page.getByTestId(`events-no-results-radius-select`)).toHaveValue(`100`);
		await expect(page.getByTestId(`plzCityInput-header-summary`)).toContainText(`Berlin`);
		await expect(page.getByTestId(`events-no-results-chip-category-meditation`)).toBeVisible();
		await expect(page.getByTestId(`events-no-results-location`)).toContainText(`Berlin`);

		await page.getByTestId(`events-no-results-chip-category-meditation`).click();
		await expect(page.getByTestId(`events-no-results-chip-category-meditation`)).toHaveCount(0);

		await expect(page.getByTestId(`events-no-results-location`)).toContainText(`Berlin`);
		await expect(page.getByTestId(`events-no-results-radius`)).toBeVisible();
	});

	test(`end-of-list state keeps radius controls after scrolling through filtered results`, async ({
		page,
	}) => {
		await createEvents(page, [
			createMeditationEvent({
				name: `Berlin End List`,
				latitude: berlin.lat,
				longitude: berlin.lng,
				address: [`Berlin`],
				sourceUrl: `https://example.com/berlin-end-list`,
			}),
		]);
		await setEventLocationFilterCookie(page, {
			plzCity: `Berlin`,
			distance: `50`,
			lat: berlin.lat,
			lng: berlin.lng,
		});
		await page.goto(`/`);
		await waitForClientHydration(page);

		await expect(page.getByTestId(`event-card`)).toHaveCount(1);
		await expect(page.getByTestId(`events-no-results`)).toContainText(
			`Keine weiteren Events gefunden`,
		);
		await expect(page.getByTestId(`events-no-results-radius-select`)).toHaveValue(`50`);
		await expect(page.getByTestId(`events-no-results-location`)).toContainText(`Berlin`);
		await expect(page.getByTestId(`events-no-results-chip-location`)).toHaveCount(0);
	});
});
