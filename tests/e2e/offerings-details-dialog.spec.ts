import { expect, test } from "@playwright/test";
import { signInAsE2EUser } from "./helpers/auth";
import {
	clearTestOfferings,
	clearTestProfiles,
	createCompleteProfile,
	createOffering,
	createOfflineOffering,
	createProfile,
	E2E_DEFAULT_USER_ID,
} from "./helpers/seed";
import { offeringCardById, setGermanLocale, waitForClientHydration } from "./helpers/offering-test-utils";

const listUrl = `/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`;
const profileIds = [E2E_DEFAULT_USER_ID];

test.describe(`Offering details dialog`, () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestOfferings(page);
		await clearTestProfiles(page, profileIds);
		await createProfile(page, createCompleteProfile());
	});

	test.afterEach(async ({ page }) => {
		await clearTestOfferings(page);
		await clearTestProfiles(page, profileIds);
	});

	test(`clicking an offering opens it in a dialog`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Dialog Click Offering`, slug: `dialog-click` }));
		await page.goto(listUrl);
		await waitForClientHydration(page);

		await offeringCardById(page, offering.id).click();

		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`offering-title`)).toHaveText(`Dialog Click Offering`);
		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
	});

	test(`cold navigation to an offering url shows a page instead of a dialog`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Cold Page Offering`, slug: `cold-page` }));

		await page.goto(`/offerings/${offering.slug}`);

		await expect(page.getByTestId(`details-dialog`)).toHaveCount(0);
		await expect(page.getByTestId(`offering-title`)).toHaveText(`Cold Page Offering`);
		await expect(page.getByTestId(`all-offerings-link`)).toBeVisible();
	});

	test(`dialog stays synchronized across repeated close methods`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Back Close Offering`, slug: `back-close` }));
		await page.goto(listUrl);
		await waitForClientHydration(page);

		const offeringCard = offeringCardById(page, offering.id);
		const dialog = page.getByTestId(`details-dialog`);

		await offeringCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
		await page.keyboard.press(`Escape`);
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);

		await offeringCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
		await dialog.getByTestId(`dialog-close`).click({ force: true });
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);

		// Browser back closes a freshly pushed dialog entry.
		await offeringCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
		await page.goBack();
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);

		// Rapid reopen after dismiss must still be closable.
		await offeringCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await page.keyboard.press(`Escape`);
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);
		await offeringCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await page.keyboard.press(`Escape`);
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);
		await expect(page.locator(`[data-dialog-overlay]`)).toHaveCount(0);

		// Stress: many open/close cycles must not leave a stuck overlay after the URL resets.
		for (let i = 0; i < 8; i++) {
			await offeringCard.click();
			await expect(dialog).toBeVisible({ timeout: 15000 });
			await expect(page.locator(`[data-dialog-overlay]`)).toHaveCount(1);
			await page.keyboard.press(`Escape`);
			await expect(dialog).toHaveCount(0);
			await expect(page).toHaveURL(listUrl);
			await expect(page.locator(`[data-dialog-overlay]`)).toHaveCount(0);
		}
	});

	test(`creating an offering opens it in a dialog and dismissing does not reopen it`, async ({ page }) => {
		await signInAsE2EUser(page);
		await page.context().addCookies([
			{
				name: `blissbase_filters`,
				value: encodeURIComponent(
					JSON.stringify({
						plzCity: `Berlin`,
						distance: `50`,
						lat: 52.52,
						lng: 13.405,
					}),
				),
				domain: `localhost`,
				path: `/`,
			},
		]);
		await page.goto(listUrl);
		await waitForClientHydration(page);
		await page.getByTestId(`create-offering`).click();
		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `offering`);
		await page.getByTestId(`offering-title-input`).fill(`Post Create Dialog Offering`);
		await page.getByTestId(`wizard-primary`).click();

		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`offering-title`)).toHaveText(`Post Create Dialog Offering`);
		await expect(page).toHaveURL(new RegExp(`/offerings/[^/?]+$`));

		await page.getByTestId(`dialog-close`).click();
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);
		await page.waitForTimeout(1000);
		await expect(page.getByTestId(`details-dialog`)).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);
	});

	test(`hovering favorites after close still opens another offering`, async ({ page }) => {
		await signInAsE2EUser(page);
		const first = await createOffering(page, createOfflineOffering({ title: `First Hover Offering`, slug: `first-hover` }));
		const second = await createOffering(page, createOfflineOffering({ title: `Second Hover Offering`, slug: `second-hover` }));
		await page.goto(listUrl);
		await waitForClientHydration(page);

		await offeringCardById(page, first.id).click();
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await page.keyboard.press(`Escape`);
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);

		const favorites = page.getByTestId(`nav-favorites`);
		await expect(favorites).toBeVisible();
		await favorites.hover();
		await page.waitForTimeout(800);
		await offeringCardById(page, second.id).click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`offering-title`)).toHaveText(`Second Hover Offering`);
		await expect(page).toHaveURL(new RegExp(`/offerings/${second.slug}$`));
	});
});
