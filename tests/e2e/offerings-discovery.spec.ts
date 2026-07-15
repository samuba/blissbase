import { expect, test } from "@playwright/test";
import { signInAsE2EUser } from "./helpers/auth";
import {
	clearTestOfferings,
	clearTestProfiles,
	createCompleteProfile,
	createOffering,
	createOfflineOffering,
	createOnlineOffering,
	createProfile,
	E2E_DEFAULT_USER_ID,
} from "./helpers/seed";
import { setGermanLocale, waitForClientHydration } from "./helpers/offering-test-utils";

const farUserId = `00000000-0000-4000-8000-000000000003`;
const incompleteUserId = `00000000-0000-4000-8000-000000000004`;
const profileIds = [E2E_DEFAULT_USER_ID, farUserId, incompleteUserId];

test.describe("Offering discovery and details", () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestOfferings(page);
		await clearTestProfiles(page, profileIds);
	});

	test.afterEach(async ({ page }) => {
		await clearTestOfferings(page);
		await clearTestProfiles(page, profileIds);
	});

	test("shows only listed offerings backed by eligible public profiles", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await createProfile(
			page,
			createCompleteProfile({
				id: incompleteUserId,
				slug: `missing-contact`,
				displayName: `Missing Contact`,
				socialLinks: [],
			}),
		);
		await createOffering(page, createOfflineOffering({ title: `Visible Offering`, slug: `visible` }));
		await createOffering(page, createOfflineOffering({ title: `Hidden Unlisted`, slug: `unlisted`, listed: false }));
		await createOffering(
			page,
			createOfflineOffering({
				profileId: incompleteUserId,
				title: `Hidden Incomplete Profile`,
				slug: `incomplete`,
			}),
		);

		await page.goto(`/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`);
		await expect(page.getByRole(`heading`, { name: `Visible Offering` })).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `Hidden Unlisted` })).toHaveCount(0);
		await expect(page.getByRole(`heading`, { name: `Hidden Incomplete Profile` })).toHaveCount(0);
	});

	test("search filters exact results across title, description, and profile name", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await createProfile(
			page,
			createCompleteProfile({
				id: farUserId,
				slug: `search-other`,
				displayName: `Sound Practitioner`,
			}),
		);
		await createOffering(
			page,
			createOfflineOffering({
				title: `Somatic Coaching`,
				descriptionHtml: `<p>Grounding session</p>`,
				slug: `somatic`,
			}),
		);
		await createOffering(
			page,
			createOfflineOffering({
				profileId: farUserId,
				title: `Sound Bath`,
				descriptionHtml: `<p>Deep resonance</p>`,
				slug: `sound`,
			}),
		);

		const listUrl = `/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`;
		for (const searchTerm of [`somatic`, `grounding`, `E2E User`]) {
			await page.goto(`${listUrl}&searchTerm=${encodeURIComponent(searchTerm)}`);
			await expect(page.getByRole(`heading`, { name: `Somatic Coaching` })).toBeVisible();
			await expect(page.getByRole(`heading`, { name: `Sound Bath` })).toHaveCount(0);
		}
	});

	test("location filtering excludes far offline offerings and optionally includes online", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await createProfile(
			page,
			createCompleteProfile({
				id: farUserId,
				slug: `far-user`,
				displayName: `Far User`,
				locationLabel: `Munich`,
				latitude: 48.137,
				longitude: 11.575,
			}),
		);
		await createOffering(page, createOfflineOffering({ title: `Nearby Offline`, slug: `nearby` }));
		await createOffering(
			page,
			createOfflineOffering({
				profileId: farUserId,
				title: `Far Offline`,
				slug: `far`,
			}),
		);
		await createOffering(page, createOnlineOffering({ title: `Always Online`, slug: `online` }));
		await createOffering(
			page,
			createOfflineOffering({
				title: `Nearby Hybrid`,
				slug: `nearby-hybrid`,
				format: `offline+online`,
			}),
		);
		await createOffering(
			page,
			createOfflineOffering({
				profileId: farUserId,
				title: `Far Hybrid`,
				slug: `far-hybrid`,
				format: `offline+online`,
			}),
		);

		await page.goto(`/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`);
		await expect(page.getByRole(`heading`, { name: `Nearby Offline` })).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `Nearby Hybrid` })).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `Far Offline` })).toHaveCount(0);
		await expect(page.getByRole(`heading`, { name: `Far Hybrid` })).toHaveCount(0);
		await expect(page.getByRole(`heading`, { name: `Always Online` })).toHaveCount(0);

		await page.goto(`/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405&includeOnline=1`);
		await expect(page.getByRole(`heading`, { name: `Nearby Offline` })).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `Nearby Hybrid` })).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `Always Online` })).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `Far Hybrid` })).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `Far Offline` })).toHaveCount(0);
	});

	test("card dialog closes back to the exact list URL and browser back closes it", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		const offering = await createOffering(page, createOfflineOffering({ title: `Dialog Offering`, slug: `dialog` }));
		const listUrl = `/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`;
		await page.goto(listUrl);
		await waitForClientHydration(page);

		await page.locator(`[data-offering-id="${offering.id}"]`).click();
		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
		await expect(page.getByRole(`dialog`)).toBeVisible();
		await page.getByRole(`button`, { name: `Schließen` }).click();
		await expect(page).toHaveURL(listUrl);

		await page.locator(`[data-offering-id="${offering.id}"]`).click();
		await page.goBack();
		await expect(page.getByRole(`dialog`)).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);
	});

	test("cold visit to offering details opens as a full page without dialog", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		const offering = await createOffering(page, createOfflineOffering({ title: `Cold Page Offering`, slug: `cold-page` }));

		await page.goto(`/offerings/${offering.slug}`);
		await expect(page.getByRole(`dialog`)).toHaveCount(0);
		await expect(page.getByRole(`heading`, { name: `Cold Page Offering` })).toBeVisible();
		await expect(page.getByRole(`link`, { name: `Alle Angebote` })).toBeVisible();
	});

	test("post-create opens the offering as a full page", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		const returnTo = `/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`;
		await page.goto(`/offerings/new?returnTo=${encodeURIComponent(returnTo)}`);
		await expect(page.getByRole(`heading`, { name: `Angebot erstellen` })).toBeVisible();
		await expect(page.getByRole(`combobox`)).toHaveValue(`Berlin`);
		await page.getByPlaceholder(`z.B. Atemarbeit 1:1 Session`).fill(`Return Page Offering`);
		await page.getByRole(`button`, { name: `Angebot speichern` }).click();

		await expect(page).toHaveURL(/\/offerings\/[^/?]+$/);
		await expect(page.getByRole(`dialog`)).toHaveCount(0);
		await expect(page.getByRole(`heading`, { name: `Return Page Offering` })).toBeVisible();
		await expect(page.getByRole(`link`, { name: `Alle Angebote` })).toBeVisible();
	});
});
