import { devices, type Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";
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

test.describe(`Offering share`, () => {
	test.use({ permissions: [`clipboard-read`, `clipboard-write`] });

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

	test(`copies the stable offering URL from the list dialog`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Dialog Share Offering`, slug: `dialog-share` }));
		await page.goto(listUrl);
		await waitForClientHydration(page);

		await offeringCardById(page, offering.id).click();
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible();
		const share = dialog.getByTestId(`offering-share`);
		await expect(share).toHaveAccessibleName(`Link kopieren`);
		await share.click();

		await expect(page.getByTestId(`share-copied`)).toBeVisible();
		await expect(page.getByTestId(`share-copied`)).toHaveText(`Link kopiert`);
		await expectCopiedOfferingUrl(page, offering.slug);
		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
	});

	test(`copies the stable offering URL from the offering page without returnTo`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Page Share Offering`, slug: `page-share` }));
		await page.goto(`/offerings/${offering.slug}?returnTo=${encodeURIComponent(listUrl)}`);
		await waitForClientHydration(page);

		await expect(page.getByTestId(`details-dialog`)).toHaveCount(0);
		const share = page.getByTestId(`offering-share`);
		await expect(share).toBeVisible();
		await share.focus();
		await page.keyboard.press(`Enter`);

		await expect(page.getByTestId(`share-copied`)).toBeVisible();
		await expectCopiedOfferingUrl(page, offering.slug);
		await expect(page).toHaveURL(new RegExp(`returnTo=`));
	});

	test(`owners copy the public offering URL from their offerings`, async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Owner Share Offering`, slug: `owner-share` }));
		await signInAsE2EUser(page);
		await page.goto(`/profile/offerings`);
		await waitForClientHydration(page);

		await offeringCardById(page, offering.id).click();
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId(`offering-edit-link`)).toBeVisible();
		await dialog.getByTestId(`offering-share`).click();

		await expect(page.getByTestId(`share-copied`)).toBeVisible();
		await expectCopiedOfferingUrl(page, offering.slug);
	});

	test.describe(`touch devices`, () => {
		test.use({
			viewport: devices[`Pixel 5`].viewport,
			userAgent: devices[`Pixel 5`].userAgent,
			hasTouch: true,
			isMobile: true,
		});

		test(`opens the system share sheet with the stable offering URL`, async ({ page }) => {
			const offering = await createOffering(page, createOfflineOffering({ title: `Touch Share Offering`, slug: `touch-share` }));
			await page.addInitScript(() => {
				const originalMatchMedia = window.matchMedia.bind(window);
				window.matchMedia = (query: string) => {
					if (query.includes(`pointer`) && query.includes(`coarse`)) {
						return {
							matches: true,
							media: query,
							onchange: null,
							addEventListener() {},
							removeEventListener() {},
							addListener() {},
							removeListener() {},
							dispatchEvent() {
								return false;
							},
						};
					}
					return originalMatchMedia(query);
				};

				const share = async (data: ShareData) => {
					(window as Window & { __shared?: ShareData }).__shared = data;
				};
				try {
					Object.defineProperty(navigator, `share`, { configurable: true, writable: true, value: share });
				} catch {
					navigator.share = share;
				}
			});

			await page.goto(`/offerings/${offering.slug}`);
			await waitForClientHydration(page);
			await page.evaluate(() => navigator.clipboard.writeText(`not-copied`));

			const share = page.getByTestId(`offering-share`);
			await share.scrollIntoViewIfNeeded();
			await expect(share).toBeInViewport();
			await expect(share).toHaveAccessibleName(`Teilen`);
			await share.click();

			await expect
				.poll(() => page.evaluate(() => (window as Window & { __shared?: ShareData }).__shared?.url))
				.toBe(offeringShareUrl(offering.slug));
			const shared = await page.evaluate(() => (window as Window & { __shared?: ShareData }).__shared);
			expect(shared?.title).toBe(`Touch Share Offering`);
			expect(shared?.url).toBe(offeringShareUrl(offering.slug));
			expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`not-copied`);
			await expect(page.getByTestId(`share-copied`)).toBeHidden();
		});
	});
});

async function expectCopiedOfferingUrl(page: Page, slug: string) {
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toBe(offeringShareUrl(slug));
	expect(copied).not.toContain(`returnTo`);
	expect(copied).not.toContain(`localhost`);
	expect(copied).not.toContain(`127.0.0.1`);
}

function offeringShareUrl(slug: string) {
	return `https://blissbase.app/offerings/${slug}`;
}
