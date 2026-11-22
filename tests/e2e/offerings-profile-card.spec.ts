import { expect, test } from "./helpers/fixtures";
import {
	clearTestOfferings,
	clearTestProfiles,
	createCompleteProfile,
	createOffering,
	createOfflineOffering,
	createProfile,
	E2E_DEFAULT_USER_ID,
} from "./helpers/seed";
import { setGermanLocale, waitForClientHydration } from "./helpers/offering-test-utils";

const profileIds = [E2E_DEFAULT_USER_ID];

test.describe(`Offering profile card`, () => {
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

	test(`contact buttons open the external link and stay on the offering page`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Profile Card Offering`, slug: `profile-card` }));
		await page.goto(`/offerings/${offering.slug}`);
		await waitForClientHydration(page);

		const card = page.getByTestId(`public-profile-card-link`);
		await expect(card).toBeVisible();
		await expect(card.getByTestId(`profile-contact-website`)).toHaveCount(0);

		const popupPromise = page.waitForEvent(`popup`);
		await page.getByTestId(`profile-contact-website`).filter({ visible: true }).click();
		const popup = await popupPromise;
		await popup.close();

		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
	});

	test(`profile header links to the profile page`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Profile Link Offering`, slug: `profile-link` }));
		await page.goto(`/offerings/${offering.slug}`);
		await waitForClientHydration(page);

		await page.getByTestId(`public-profile-card-link`).click();
		await expect(page).toHaveURL(/\/@\/e2e-user$/);
	});
});
