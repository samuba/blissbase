import type { Locator, Page } from "@playwright/test";

export async function setGermanLocale(page: Page) {
	await page.context().addCookies([
		{
			name: `locale`,
			value: `de`,
			domain: `localhost`,
			path: `/`,
		},
	]);
}

export async function waitForClientHydration(page: Page) {
	await page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
			}),
	);
}

export async function mockSupabaseOtpRequest(page: Page) {
	await page.route(`**/auth/v1/otp**`, async (route) => {
		if (route.request().method() !== `POST`) {
			await route.continue();
			return;
		}

		await route.fulfill({
			status: 200,
			contentType: `application/json`,
			body: `{}`,
		});
	});
}

export async function mockGooglePlacesAutocomplete(page: Page) {
	await page.addInitScript(() => {
		const places = [
			{ name: `Berlin`, address: `Berlin, Germany`, lat: 52.52, lng: 13.405 },
			{ name: `Munich`, address: `Munich, Germany`, lat: 48.137, lng: 11.575 },
		];
		const predictions = places.map((place) => ({
			text: { toString: () => place.address },
			toPlace: () => ({
				fetchFields: async () => {},
				displayName: place.name,
				formattedAddress: place.address,
				location: {
					lat: () => place.lat,
					lng: () => place.lng,
				},
			}),
		}));

		const googleMock = {
			maps: {
				importLibrary: async () => ({
					AutocompleteSessionToken: class AutocompleteSessionToken {},
					AutocompleteSuggestion: {
						fetchAutocompleteSuggestions: async (request: { input: string }) => ({
							suggestions: predictions
								.filter((prediction) => prediction.text.toString().toLowerCase().includes(request.input.toLowerCase()))
								.map((placePrediction) => ({ placePrediction })),
						}),
					},
				}),
			},
		};
		Object.defineProperty(window, `google`, { configurable: true, value: googleMock });
	});
}

export async function chooseLocation(page: Page, args: { inputId: string; query?: string; option?: string }) {
	const input = page.locator(`#${args.inputId}`);
	await input.fill(args.query ?? `Ber`);
	const suggestions = page.locator(`#${args.inputId}-listbox`);
	await suggestions.waitFor({ state: `visible`, timeout: 10000 });
	await expectSelectedOption(suggestions.getByRole(`option`, { name: args.option ?? `Berlin, Germany` }));
	await input.press(`Enter`);
}

async function expectSelectedOption(option: Locator) {
	await option.waitFor({ state: `visible` });
	const selected = await option.getAttribute(`aria-selected`);
	if (selected !== `true`) throw new Error(`Expected location option to be selected`);
}
