import { expect, test } from "./helpers/fixtures";
import {
	E2E_DEFAULT_USER_ID,
	clearTestEvents,
	clearTestOfferings,
	clearTestProfiles,
	createCompleteProfile,
	createEvents,
	createMeditationEvent,
	createOffering,
	createOfflineOffering,
	createProfile,
} from "./helpers/seed";
import { waitForClientHydration } from "./helpers/offering-test-utils";

test.describe(`cross promo footer`, () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await clearTestOfferings(page);
		await clearTestProfiles(page, [E2E_DEFAULT_USER_ID]);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
		await clearTestOfferings(page);
		await clearTestProfiles(page, [E2E_DEFAULT_USER_ID]);
	});

	test(`offerings page keeps the events promo`, async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await createOffering(page, createOfflineOffering({ title: `Promo Offering`, slug: `promo-offering` }));

		await page.goto(`/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`);
		await waitForClientHydration(page);

		const promo = page.getByTestId(`events-cross-promo`);
		await expect(promo).toBeVisible();
		await expect(promo).toContainText(`Suchst du Events?`);
		await expect(promo).toContainText(`Wir haben sehr viele!`);
		await expect(page.getByTestId(`events-cross-promo-link`)).toHaveAttribute(`href`, `/?searchTerm=Berlin`);
		await expect(page.getByTestId(`events-cross-promo-link`)).toContainText(`Events anzeigen`);
		await page.getByTestId(`events-cross-promo-link`).click();
		await expect(page).toHaveURL(/searchTerm=Berlin/);
		await expect(page.getByTestId(`hero-logo`)).toBeVisible();
	});

	test(`events page shows the offerings promo when there are no events`, async ({ page }) => {
		await page.goto(`/`);
		await waitForClientHydration(page);

		const promo = page.getByTestId(`offerings-cross-promo`);
		await expect(promo).toBeVisible();
		await expect(promo).toContainText(`Suchst du Eins-zu-eins-Sessions?`);
		await expect(promo).toContainText(`Wir haben viele verschiedene Angebote.`);
		await expect(page.getByTestId(`offerings-cross-promo-link`)).toHaveAttribute(`href`, `/offerings`);
		await expect(page.getByTestId(`offerings-cross-promo-link`)).toContainText(`Angebote anzeigen`);
		await page.getByTestId(`offerings-cross-promo-link`).click();
		await expect(page).toHaveURL(/\/offerings$/);
		await expect(page.getByTestId(`events-cross-promo`)).toBeVisible();
	});

	test(`events page shows the offerings promo when the list is finished`, async ({ page }) => {
		await createEvents(page, [createMeditationEvent({ name: `Only Event`, slug: `only-event` })]);

		await page.goto(`/`);
		await waitForClientHydration(page);
		await expect(page.getByTestId(`event-card`)).toHaveCount(1);

		const promo = page.getByTestId(`offerings-cross-promo`);
		await promo.scrollIntoViewIfNeeded();
		await expect(promo).toBeVisible();
	});

	test(`events page hides the offerings promo while more events can load`, async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 500 });
		await createEvents(
			page,
			Array.from({ length: 9 }, (_, index) =>
				createMeditationEvent({
					name: `Promo Event ${index + 1}`,
					slug: `promo-event-${index + 1}`,
					startAt: new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
				}),
			),
		);

		await page.goto(`/`);
		await waitForClientHydration(page);
		await expect(page.getByTestId(`event-card`)).toHaveCount(8);
		await expect(page.getByTestId(`offerings-cross-promo`)).toHaveCount(0);

		await page.getByTestId(`events-load-more`).scrollIntoViewIfNeeded();

		await expect(page.getByTestId(`event-card`)).toHaveCount(9);
		const promo = page.getByTestId(`offerings-cross-promo`);
		await promo.scrollIntoViewIfNeeded();
		await expect(promo).toBeVisible();
	});
});
