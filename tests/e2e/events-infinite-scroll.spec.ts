import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";
import { clearTestEvents, createEvents, createMeditationEvent } from "./helpers/seed";
import { waitForClientHydration } from "./helpers/offering-test-utils";

test.describe(`events infinite scroll`, () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await seedScrollEvents(page, 17);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test(`shows the end-of-list message only after the last page loaded`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 500 });
		await page.goto(`/`);
		await waitForClientHydration(page);
		const cards = page.getByTestId(`event-card`);
		const endOfList = page.getByTestId(`events-no-results`);

		await expect(cards).toHaveCount(8);
		await expect(endOfList).toHaveCount(0);

		await page.getByTestId(`events-load-more`).scrollIntoViewIfNeeded();
		await expect(cards).toHaveCount(16);
		await expect(endOfList).toHaveCount(0);

		await page.getByTestId(`events-load-more`).scrollIntoViewIfNeeded();
		await expect(cards).toHaveCount(17);
		await expect(endOfList).toContainText(`Keine weiteren Events gefunden`);

		const lastCardBox = await cards.last().boundingBox();
		const endOfListBox = await endOfList.boundingBox();
		expect(endOfListBox!.y).toBeGreaterThanOrEqual(lastCardBox!.y + lastCardBox!.height);
	});

	test(`keeps loading pages while the end of the list stays in view`, async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 6000 });
		await page.goto(`/`);
		await waitForClientHydration(page);

		await expect(page.getByTestId(`event-card`)).toHaveCount(17);
		await expect(page.getByTestId(`events-no-results`)).toContainText(`Keine weiteren Events gefunden`);
	});

	test(`shows a retry button when loading more fails and recovers on retry`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 500 });
		await page.goto(`/`);
		await waitForClientHydration(page);
		const cards = page.getByTestId(`event-card`);
		const error = page.getByTestId(`events-load-more-error`);
		const retry = page.getByTestId(`events-load-more-retry`);
		await expect(cards).toHaveCount(8);

		let attempt = 0;
		let releaseRetry = () => {};
		const retryReleased = new Promise<void>((resolve) => (releaseRetry = resolve));
		await page.route(`**/_app/remote/**`, async (route) => {
			if (!isEventsRequest(route.request().url())) return route.continue();
			attempt++;
			if (attempt === 1) return route.abort(`failed`);
			if (attempt === 2) await retryReleased;
			return route.continue();
		});

		await page.getByTestId(`events-load-more`).scrollIntoViewIfNeeded();
		await expect(error).toBeVisible();
		await expect(error).toHaveAttribute(`role`, `alert`);
		await expect(error).toContainText(`Weitere Events konnten nicht geladen werden`);
		await expect(cards).toHaveCount(8);
		await expect(page.getByTestId(`events-no-results`)).toHaveCount(0);
		await expect(page.getByTestId(`offerings-cross-promo`)).toHaveCount(0);

		await retry.focus();
		await expect(retry).toBeFocused();
		await page.keyboard.press(`Enter`);
		await expect(page.getByTestId(`events-loading`)).toBeVisible();
		await expect(error).toHaveCount(0);

		releaseRetry();
		// 16 (not 9) cards proves the retry re-requested page 2 instead of skipping to page 3.
		await expect(cards).toHaveCount(16);
		await expect(error).toHaveCount(0);
		await expect(page.getByTestId(`events-no-results`)).toHaveCount(0);

		await page.getByTestId(`events-load-more`).scrollIntoViewIfNeeded();
		await expect(cards).toHaveCount(17);
		await expect(page.getByTestId(`events-no-results`)).toContainText(`Keine weiteren Events gefunden`);
	});

	test(`keeps the loading state while a newer filter request is still pending`, async ({ page }) => {
		await page.goto(`/`);
		await waitForClientHydration(page);
		const cards = page.getByTestId(`event-card`);
		await expect(cards).toHaveCount(8);

		const searchInput = page.getByTestId(`event-search-input`);
		await searchInput.click();
		await searchInput.fill(`Scroll`);
		await searchInput.press(`Enter`);
		await expect(cards).toHaveCount(8);

		const heldCategoryRequest = holdEventsRequest({ page, bodyIncludes: `meditation` });
		const clearSearchRequestFinished = page.waitForEvent(`requestfinished`, (request) =>
			isEventsRequest(request.url()),
		);
		// Selecting a category clears the text search first, so this fires two overlapping requests.
		await page.getByTestId(`category-chip-meditation`).click();
		await clearSearchRequestFinished;
		const route = await heldCategoryRequest;
		// Give the stale response time to (wrongly) end the loading state before asserting it did not.
		await page.waitForTimeout(300);

		await expect(page.getByTestId(`events-loading`)).toBeVisible();
		await expect(cards).toHaveCount(0);

		await route.continue();
		await expect(page.getByTestId(`events-loading`)).toHaveCount(0);
		await expect(cards).toHaveCount(8);
	});
});

async function seedScrollEvents(page: Page, count: number) {
	await createEvents(
		page,
		Array.from({ length: count }, (_, index) =>
			createMeditationEvent({
				name: `Scroll Event ${index + 1}`,
				slug: `scroll-event-${index + 1}`,
				startAt: new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
			}),
		),
	);
}

function isEventsRequest(url: string) {
	return url.includes(`/_app/remote/`) && url.includes(`fetchEventsWithCookiePersistence`);
}

/** Resolves with the intercepted route once a matching events request is held back. */
function holdEventsRequest(args: { page: Page; bodyIncludes: string }) {
	return new Promise<Route>((resolve) => {
		void args.page.route(`**/_app/remote/**`, async (route) => {
			const request = route.request();
			const payload = Buffer.from(request.postDataJSON()?.payload ?? ``, `base64`).toString();
			if (!isEventsRequest(request.url()) || !payload.includes(args.bodyIncludes)) {
				await route.continue();
				return;
			}
			resolve(route);
		});
	});
}
