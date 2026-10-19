import { expect, test } from "./helpers/fixtures";
import { clearTestEvents, createEvents, createMeditationEvent } from "./helpers/seed";
import { waitForClientHydration } from "./helpers/offering-test-utils";

test.describe(`events infinite scroll`, () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test(`shows the end-of-list message only after the last page loaded`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 500 });
		await createEvents(
			page,
			Array.from({ length: 17 }, (_, index) =>
				createMeditationEvent({
					name: `Scroll Event ${index + 1}`,
					slug: `scroll-event-${index + 1}`,
					startAt: new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
				}),
			),
		);

		await page.goto(`/`);
		await waitForClientHydration(page);
		const cards = page.getByTestId(`event-card`);
		const noResults = page.getByTestId(`events-no-results`);

		await expect(cards).toHaveCount(8);
		await expect(noResults).toHaveCount(0);

		await page.getByTestId(`events-load-more`).scrollIntoViewIfNeeded();
		await expect(cards).toHaveCount(16);
		await expect(noResults).toHaveCount(0);

		await page.getByTestId(`events-load-more`).scrollIntoViewIfNeeded();
		await expect(cards).toHaveCount(17);
		await expect(noResults).toContainText(`Keine weiteren Events gefunden`);

		const lastCardBox = await cards.last().boundingBox();
		const noResultsBox = await noResults.boundingBox();
		expect(noResultsBox!.y).toBeGreaterThanOrEqual(lastCardBox!.y + lastCardBox!.height);
	});
});
