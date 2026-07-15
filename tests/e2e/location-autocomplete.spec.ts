import { test, expect } from '@playwright/test';
import { createEvents, clearTestEvents, createMeditationEvent, createYogaEvent } from './helpers/seed';

async function mockGooglePlacesAutocomplete(page: import('@playwright/test').Page) {
	await page.addInitScript(() => {
		const predictions = [
			{
				text: { toString: () => `Berlin, Germany` },
				toPlace: () => ({
					fetchFields: async () => {},
					displayName: `Berlin`,
					formattedAddress: `Berlin, Germany`,
					location: {
						lat: () => 52.52,
						lng: () => 13.405
					}
				})
			},
			{
				text: { toString: () => `Bern, Switzerland` },
				toPlace: () => ({
					fetchFields: async () => {},
					displayName: `Bern`,
					formattedAddress: `Bern, Switzerland`,
					location: {
						lat: () => 46.948,
						lng: () => 7.447
					}
				})
			}
		];

		const googleMock = {
			maps: {
				importLibrary: async (name: string) => {
					if (name !== `places`) throw new Error(`Unknown library`);
					return {
						AutocompleteSessionToken: class AutocompleteSessionToken {},
						AutocompleteSuggestion: {
							fetchAutocompleteSuggestions: async (request: { input: string }) => ({
								suggestions: predictions
									.filter((prediction) =>
										prediction.text.toString().toLowerCase().includes(request.input.toLowerCase())
									)
									.map((placePrediction) => ({ placePrediction }))
							})
						}
					};
				}
			}
		};

		// @ts-expect-error test mock
		window.google = googleMock;
	});
}

test.describe('Location autocomplete', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvents(page, [
			createMeditationEvent({ address: [`Berlin Center`, `Berlin`] }),
			createYogaEvent({ address: [`Munich Studio`, `Munich`] })
		]);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	async function gotoHomeAndWait(page: import('@playwright/test').Page) {
		await page.goto(`/`);
		await page.waitForSelector(`[data-testid="event-card"]`, { timeout: 15000 });
	}

	async function typeForSuggestions(page: import('@playwright/test').Page, value: string) {
		const headerInput = page.locator(`#plzCityInput-header`);
		await headerInput.click();
		await page.waitForFunction(() => typeof window.google?.maps?.importLibrary === `function`);
		await headerInput.fill(value);
		await expect(headerInput).toHaveValue(value);
	}

	test('typing opens suggestions when Google is available', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await typeForSuggestions(page, `Ber`);
		await expect(page.getByTestId(`location-suggestions`).first()).toBeVisible({ timeout: 10000 });
	});

	test('keyboard selection applies coordinates and distance', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await typeForSuggestions(page, `Ber`);
		await expect(page.getByTestId(`location-suggestions`).first()).toBeVisible({ timeout: 10000 });
		await page.keyboard.press(`Enter`);

		await expect(page.locator(`#plzCityInput-header`)).toHaveValue(`Berlin`);
		await expect(page.locator(`#plzCityInput-header-distance`)).toHaveValue(`50`);
	});

	test('mouse selection works', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await typeForSuggestions(page, `Ber`);
		const suggestions = page.getByTestId(`location-suggestions`).first();
		await expect(suggestions).toBeVisible({ timeout: 5000 });
		await suggestions.getByRole(`option`, { name: `Bern, Switzerland` }).click();

		await expect(page.locator(`#plzCityInput-header`)).toHaveValue(`Bern`);
		await expect(page.locator(`#plzCityInput-header-distance`)).toHaveValue(`50`);
	});

	test('escape closes the dropdown', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await typeForSuggestions(page, `Ber`);
		await expect(page.getByTestId(`location-suggestions`).first()).toBeVisible({ timeout: 10000 });
		await page.keyboard.press(`Escape`);
		await expect(page.getByTestId(`location-suggestions`)).toHaveCount(0);
	});

	test('clear resets location and distance', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		await typeForSuggestions(page, `Ber`);
		await expect(page.getByTestId(`location-suggestions`).first()).toBeVisible({ timeout: 10000 });
		await page.keyboard.press(`Enter`);
		await expect(page.locator(`#plzCityInput-header-distance`)).toHaveValue(`50`);
		await page.waitForLoadState(`networkidle`);

		const headerLocationInput = page.getByTestId(`location-distance-input`).first();
		await headerLocationInput.getByTestId(`clear-location-button`).click();

		await expect(page.locator(`#plzCityInput-header`)).toHaveValue(``, { timeout: 10000 });
		await expect(page.locator(`#plzCityInput-header-distance`)).toHaveCount(0);
	});

	test('manual Enter search works when Google is unavailable', async ({ page }) => {
		await page.addInitScript(() => {
			// @ts-expect-error test mock
			delete window.google;
		});
		await gotoHomeAndWait(page);

		const headerInput = page.locator(`#plzCityInput-header`);
		await headerInput.click();
		await headerInput.pressSequentially(`Berlin`);
		await headerInput.press(`Enter`);

		await expect(page.locator(`#plzCityInput-header-distance`)).toHaveValue(`50`);
		await expect(headerInput).toHaveValue(`Berlin`);
	});

	test('filter dialog input works with unique id', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);

		await page.getByRole(`button`, { name: `Filter`, exact: true }).click();
		const dialogInput = page.locator(`#plzCityInput-dialog`);
		await expect(dialogInput).toBeVisible();
		await dialogInput.fill(`Ber`);
		await page.waitForTimeout(400);
		await expect(page.getByTestId(`location-suggestions`).first()).toBeVisible({ timeout: 10000 });
	});
});
