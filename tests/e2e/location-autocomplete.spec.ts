import { expect, test } from './helpers/fixtures';
import { createEvents, clearTestEvents, createMeditationEvent, createYogaEvent } from './helpers/seed';
import {
	expectLocationValue,
	expectSuggestionsOpen,
	gotoHomeAndWait,
	locationRoot,
	openLocationEditor,
	typeForSuggestions,
	visibleLocationInput,
} from './helpers/location-input';
import { openFilterDialog } from './helpers/offering-test-utils';

async function mockGooglePlacesAutocomplete(page: import('@playwright/test').Page) {
	await page.route(/maps\.(googleapis|gstatic)\.com/, (route) => route.abort());
	await page.addInitScript(() => {
		const predictions = [
			{
				placeId: `berlin`,
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
				placeId: `bern`,
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
			},
			{
				placeId: `berlin`,
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
				placeId: `berlin-locality`,
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

	test('typing opens suggestions when Google is available', async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await gotoHomeAndWait(page);
		const headerInput = page.getByTestId(`plzCityInput-header`);
		await typeForSuggestions(page, { input: headerInput, value: `Ber` });
		const suggestions = await expectSuggestionsOpen(page, `plzCityInput-header`);
		const options = suggestions.getByTestId(`location-option`);
		await expect(options).toHaveCount(3);
		await expect(options.nth(0)).toHaveText(`Berlin, Germany`);
		await expect(options.nth(2)).toHaveText(`Berlin, Germany`);
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
		await expect(page.getByTestId(`clear-location-button`).first()).toBeVisible();

		const headerLocationInput = page.getByTestId(`location-distance-input`).first();
		await headerLocationInput.getByTestId(`clear-location-button`).click();

		await expectLocationValue(page, `plzCityInput-header`, ``);
		await expect(page.getByTestId(`plzCityInput-header-distance`)).toHaveCount(0);
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
