import { test, expect } from '@playwright/test';
import { createEvents, clearTestEvents, createMeditationEvent, createYogaEvent } from './helpers/seed';
import { openFilterDialog, waitForClientHydration } from './helpers/offering-test-utils';

async function mockGooglePlacesAutocomplete(page: import('@playwright/test').Page) {
	await page.route(/maps\.(googleapis|gstatic)\.com/, (route) => route.abort());
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

		Object.defineProperty(window, `google`, { configurable: true, writable: true, value: googleMock });
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
		await page.getByTestId(`event-card`).first().waitFor({ timeout: 15000 });
		await waitForClientHydration(page);
	}

	function visibleLocationInput(page: import('@playwright/test').Page, inputId: string) {
		return page.locator(`[data-testid="${inputId}"]:not([type="hidden"])`);
	}

	function locationRoot(page: import('@playwright/test').Page, inputId: string) {
		return page.getByTestId(`location-distance-input`).filter({
			has: page.getByTestId(`${inputId}-summary`)
		});
	}

	async function openLocationEditor(page: import('@playwright/test').Page, inputId: string) {
		const input = visibleLocationInput(page, inputId);
		if (await input.isVisible()) return;
		const summary = page.getByTestId(`${inputId}-summary`);
		if (await summary.isVisible()) {
			await summary.click();
		}
		await expect(input).toBeVisible();
	}

	async function typeForSuggestions(page: import('@playwright/test').Page, args: { input: import('@playwright/test').Locator; value: string }) {
		const inputId = (await args.input.getAttribute(`data-testid`)) ?? ``;
		await openLocationEditor(page, inputId);
		const input = visibleLocationInput(page, inputId);
		await input.click();
		await page.waitForFunction(() => typeof window.google?.maps?.importLibrary === `function`);
		await expect(locationRoot(page, inputId)).toHaveAttribute(`data-autocomplete-status`, `ready`, {
			timeout: 10000
		});
		await input.fill(args.value);
		await expect(input).toHaveValue(args.value);
	}

	async function expectLocationValue(page: import('@playwright/test').Page, inputId: string, value: string) {
		await expect(page.locator(`[data-testid="${inputId}"][type="hidden"]`)).toHaveValue(value);
	}

	async function expectSuggestionsOpen(_page: import('@playwright/test').Page, _inputId: string) {
		const suggestions = _page.getByTestId(`location-suggestions`);
		await expect(suggestions).toBeVisible({ timeout: 10000 });
		return suggestions;
	}

	test('typing opens suggestions when Google is available', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		const headerInput = page.getByTestId(`plzCityInput-header`);
		await typeForSuggestions(page, { input: headerInput, value: `Ber` });
		await expectSuggestionsOpen(page, `plzCityInput-header`);
	});

	test('keyboard selection applies coordinates and distance', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		const headerInput = page.getByTestId(`plzCityInput-header`);
		await typeForSuggestions(page, { input: headerInput, value: `Ber` });
		const suggestions = await expectSuggestionsOpen(page, `plzCityInput-header`);
		const berlinOption = suggestions.getByTestId(`location-option`).first();
		await expect(berlinOption).toHaveAttribute(`aria-selected`, `true`);
		const headerField = visibleLocationInput(page, `plzCityInput-header`);
		await headerField.focus();
		await page.keyboard.press(`Enter`);

		await expectLocationValue(page, `plzCityInput-header`, `Berlin`);
		await expectLocationValue(page, `plzCityInput-header-distance`, `50`);
	});

	test('mouse selection works', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		const headerInput = page.getByTestId(`plzCityInput-header`);
		await typeForSuggestions(page, { input: headerInput, value: `Ber` });
		const suggestions = await expectSuggestionsOpen(page, `plzCityInput-header`);
		await suggestions.getByTestId(`location-option`).nth(1).click();

		await expectLocationValue(page, `plzCityInput-header`, `Bern`);
		await expectLocationValue(page, `plzCityInput-header-distance`, `50`);
	});

	test('escape closes the dropdown', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		const headerInput = page.getByTestId(`plzCityInput-header`);
		await typeForSuggestions(page, { input: headerInput, value: `Ber` });
		await expectSuggestionsOpen(page, `plzCityInput-header`);
		await headerInput.press(`Escape`);
		await expect(page.getByTestId(`location-suggestions`)).toHaveCount(0);
	});

	test('clear resets location and distance', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		const headerInput = page.getByTestId(`plzCityInput-header`);
		await typeForSuggestions(page, { input: headerInput, value: `Ber` });
		const suggestions = await expectSuggestionsOpen(page, `plzCityInput-header`);
		await expect(suggestions.getByTestId(`location-option`).first()).toHaveAttribute(`aria-selected`, `true`);
		const selectedInput = visibleLocationInput(page, `plzCityInput-header`);
		await selectedInput.focus();
		await page.keyboard.press(`Enter`);
		await expectLocationValue(page, `plzCityInput-header-distance`, `50`);
		await page.waitForLoadState(`networkidle`);

		const headerLocationInput = page.getByTestId(`location-distance-input`).first();
		await headerLocationInput.getByTestId(`clear-location-button`).click();

		await expectLocationValue(page, `plzCityInput-header`, ``);
		await expect(page.locator(`[data-testid="plzCityInput-header-distance"][type="hidden"]`)).toHaveCount(0);
	});

	test('trigger reopens the editor after changing distance and clearing', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		const headerInput = page.getByTestId(`plzCityInput-header`);
		await typeForSuggestions(page, { input: headerInput, value: `Ber` });
		const suggestions = await expectSuggestionsOpen(page, `plzCityInput-header`);
		await suggestions.getByTestId(`location-option`).first().click();
		await expectLocationValue(page, `plzCityInput-header`, `Berlin`);

		await openLocationEditor(page, `plzCityInput-header`);
		await page.getByTestId(`plzCityInput-header-distance`).selectOption(`100`);

		const headerLocation = page.getByTestId(`location-distance-input`).first();
		await headerLocation.getByTestId(`clear-location-button`).click();
		await expectLocationValue(page, `plzCityInput-header`, ``);

		const summary = page.getByTestId(`plzCityInput-header-summary`);
		await summary.click();
		await expect(visibleLocationInput(page, `plzCityInput-header`)).toBeVisible();
	});

	test('manual Enter search works when Google is unavailable', async ({ page }) => {
		await page.route(/maps\.(googleapis|gstatic)\.com/, (route) => route.abort());
		await page.addInitScript(() => {
			Object.defineProperty(window, `google`, { configurable: true, writable: true, value: undefined });
		});
		await gotoHomeAndWait(page);

		await openLocationEditor(page, `plzCityInput-header`);
		const headerInput = visibleLocationInput(page, `plzCityInput-header`);
		await headerInput.click();
		await expect(locationRoot(page, `plzCityInput-header`)).toHaveAttribute(
			`data-autocomplete-status`,
			`failed`,
			{ timeout: 10000 }
		);
		await headerInput.fill(`Berlin`);
		await expect(headerInput).toHaveValue(`Berlin`);
		await headerInput.focus();
		await page.keyboard.press(`Enter`);

		await expectLocationValue(page, `plzCityInput-header-distance`, `50`);
		await expectLocationValue(page, `plzCityInput-header`, `Berlin`);
	});

	test('filter dialog input works with unique id', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);

		const filterDialog = await openFilterDialog(page);
		await filterDialog.getByTestId(`plzCityInput-dialog-summary`).click();
		const dialogInput = visibleLocationInput(page, `plzCityInput-dialog`);
		await expect(dialogInput).toBeVisible();
		await typeForSuggestions(page, { input: dialogInput, value: `Ber` });
		await expectSuggestionsOpen(page, `plzCityInput-dialog`);
	});
});
