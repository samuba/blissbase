import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";
import {
	hiddenLocationInput,
	locationRoot,
	openLocationEditor,
	typeForSuggestions,
	visibleLocationInput,
	gotoHomeAndWait,
} from "./helpers/location-input";
import {
	mockGooglePlacesAutocomplete,
	setEventLocationFilterCookie,
	setGermanLocale,
} from "./helpers/offering-test-utils";
import { clearTestEvents, createEvents, createMeditationEvent, createYogaEvent } from "./helpers/seed";

const berlin = { lat: 52.52, lng: 13.405 };
const nearbyName = `Nearby Berlin Event`;
const midrangeName = `Seventy Km North Event`;
const farName = `Far Munich Event`;
const headerInputId = `plzCityInput-header`;

test.describe(`Location input filtering`, () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestEvents(page);
		await createEvents(page, [
			createMeditationEvent({
				name: nearbyName,
				latitude: berlin.lat,
				longitude: berlin.lng,
				address: [`Berlin Center`, `Berlin`],
				sourceUrl: `https://example.com/nearby-berlin-event`,
			}),
			createYogaEvent({
				name: midrangeName,
				latitude: 53.24,
				longitude: berlin.lng,
				address: [`Neuruppin`],
				sourceUrl: `https://example.com/midrange-event`,
			}),
			createYogaEvent({
				name: farName,
				latitude: 48.137,
				longitude: 11.575,
				address: [`Munich Studio`, `Munich`],
				sourceUrl: `https://example.com/far-munich-event`,
			}),
		]);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test(`selecting a city shows nearby events and hides far ones`, async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await selectSuggestedCity(page, { query: `Ber`, city: `Berlin` });

		await expectEventVisible(page, nearbyName);
		await expectEventHidden(page, midrangeName);
		await expectEventHidden(page, farName);
	});

	test(`widening the radius includes a farther event`, async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await selectSuggestedCity(page, { query: `Ber`, city: `Berlin` });
		await expectEventHidden(page, midrangeName);

		await openLocationEditor(page, headerInputId);
		await page.getByTestId(`${headerInputId}-distance`).selectOption(`100`);

		await expectEventVisible(page, nearbyName);
		await expectEventVisible(page, midrangeName);
		await expectEventHidden(page, farName);
	});

	test(`clearing the location restores unfiltered results`, async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await selectSuggestedCity(page, { query: `Ber`, city: `Berlin` });
		await expectEventHidden(page, farName);

		await locationRoot(page, headerInputId).getByTestId(`clear-location-button`).click();

		await expectEventVisible(page, nearbyName);
		await expectEventVisible(page, midrangeName);
		await expectEventVisible(page, farName);
	});

	test(`cookie location prefills the input and filters the event list`, async ({ page }) => {
		await setEventLocationFilterCookie(page, {
			plzCity: `Berlin`,
			distance: `50`,
			lat: berlin.lat,
			lng: berlin.lng,
		});
		await page.goto(`/`);

		await expect(page.getByTestId(`${headerInputId}-summary`)).toContainText(`Berlin`);
		await expectEventVisible(page, nearbyName);
		await expectEventHidden(page, midrangeName);
		await expectEventHidden(page, farName);
	});

	test(`an unknown place shows the not-found state`, async ({ page }) => {
		await page.route(/maps\.(googleapis|gstatic)\.com/, (route) => route.abort());
		await page.addInitScript(() => {
			Object.defineProperty(window, `google`, { configurable: true, writable: true, value: undefined });
		});
		await gotoHomeAndWait(page);
		await openLocationEditor(page, headerInputId);

		const input = visibleLocationInput(page, headerInputId);
		await input.fill(`NirgendwoStadtxyz`);
		await input.press(`Enter`);

		await expect(page.getByText(/NirgendwoStadtxyz/)).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(/nicht gefunden/i)).toBeVisible();
		await expectEventHidden(page, nearbyName);
	});
});

test.describe(`Location input filtering - GPS`, () => {
	test.use({
		geolocation: { latitude: berlin.lat, longitude: berlin.lng },
		permissions: [`geolocation`],
	});

	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestEvents(page);
		await createEvents(page, [
			createMeditationEvent({
				name: nearbyName,
				latitude: berlin.lat,
				longitude: berlin.lng,
				address: [`Berlin Center`, `Berlin`],
				sourceUrl: `https://example.com/gps-nearby-event`,
			}),
			createYogaEvent({
				name: farName,
				latitude: 48.137,
				longitude: 11.575,
				address: [`Munich Studio`, `Munich`],
				sourceUrl: `https://example.com/gps-far-event`,
			}),
		]);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test(`using current location filters to nearby events`, async ({ page }) => {
		await gotoHomeAndWait(page);

		await locationRoot(page, headerInputId).getByTestId(`use-current-location-button`).click();

		await expectEventVisible(page, nearbyName);
		await expectEventHidden(page, farName);
	});
});

async function selectSuggestedCity(page: Page, args: { query: string; city: string }) {
	await typeForSuggestions(page, { input: page.getByTestId(headerInputId), value: args.query });
	const option = page.getByTestId(`location-suggestions`).getByTestId(`location-option`).filter({ hasText: args.city });
	await expect(option.first()).toBeVisible({ timeout: 10000 });
	await option.first().click();
	await expect(hiddenLocationInput(page, headerInputId)).toHaveValue(args.city);
}

function eventTitle(page: Page, name: string) {
	return page.getByTestId(`event-card-title`).filter({ hasText: name });
}

async function expectEventVisible(page: Page, name: string) {
	await expect(eventTitle(page, name)).toBeVisible({ timeout: 15000 });
}

async function expectEventHidden(page: Page, name: string) {
	await expect(eventTitle(page, name)).toHaveCount(0, { timeout: 15000 });
}
