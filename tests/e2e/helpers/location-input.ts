import { expect, type Locator, type Page } from "@playwright/test";
import { waitForClientHydration } from "./offering-test-utils";

export async function gotoHomeAndWait(page: Page) {
	await page.goto(`/`);
	await page.getByTestId(`event-card`).first().waitFor({ timeout: 15000 });
	await waitForClientHydration(page);
}

export function visibleLocationInput(page: Page, inputId: string) {
	return page.getByTestId(inputId).filter({ visible: true });
}

export function hiddenLocationInput(page: Page, inputId: string) {
	return page.getByTestId(inputId).filter({ visible: false });
}

export function locationRoot(page: Page, inputId: string) {
	return page.getByTestId(`location-distance-input`).filter({
		has: page.getByTestId(`${inputId}-summary`),
	});
}

export async function openLocationEditor(page: Page, inputId: string) {
	const input = visibleLocationInput(page, inputId);
	if (await input.isVisible()) return;
	const summary = page.getByTestId(`${inputId}-summary`);
	if (await summary.isVisible()) {
		await summary.click();
	}
	await expect(input).toBeVisible();
}

export async function typeForSuggestions(page: Page, args: { input: Locator; value: string }) {
	const inputId = (await args.input.getAttribute(`data-testid`)) ?? ``;
	await openLocationEditor(page, inputId);
	const input = visibleLocationInput(page, inputId);
	await input.click();
	await page.waitForFunction(() => typeof window.google?.maps?.importLibrary === `function`);
	await expect(locationRoot(page, inputId)).toHaveAttribute(`data-autocomplete-status`, `ready`, {
		timeout: 10000,
	});
	await input.fill(args.value);
	await expect(input).toHaveValue(args.value);
}

export async function expectLocationValue(page: Page, inputId: string, value: string) {
	await expect(hiddenLocationInput(page, inputId)).toHaveValue(value);
}

export async function expectSuggestionsOpen(page: Page, _inputId: string) {
	const suggestions = page.getByTestId(`location-suggestions`);
	await expect(suggestions).toBeVisible({ timeout: 10000 });
	return suggestions;
}
