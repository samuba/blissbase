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
import { offeringCardById, setGermanLocale, waitForClientHydration } from "./helpers/offering-test-utils";

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
		const visible = await createOffering(page, createOfflineOffering({ title: `Visible Offering`, slug: `visible` }));
		const unlisted = await createOffering(page, createOfflineOffering({ title: `Hidden Unlisted`, slug: `unlisted`, listed: false }));
		const incomplete = await createOffering(
			page,
			createOfflineOffering({
				profileId: incompleteUserId,
				title: `Hidden Incomplete Profile`,
				slug: `incomplete`,
			}),
		);

		await page.goto(`/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`);
		await expect(offeringCardById(page, visible.id)).toBeVisible();
		await expect(offeringCardById(page, unlisted.id)).toHaveCount(0);
		await expect(offeringCardById(page, incomplete.id)).toHaveCount(0);
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
		const somatic = await createOffering(
			page,
			createOfflineOffering({
				title: `Somatic Coaching`,
				descriptionHtml: `<p>Grounding session</p>`,
				slug: `somatic`,
			}),
		);
		const sound = await createOffering(
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
			await expect(offeringCardById(page, somatic.id)).toBeVisible();
			await expect(offeringCardById(page, sound.id)).toHaveCount(0);
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
		const nearbyOffline = await createOffering(page, createOfflineOffering({ title: `Nearby Offline`, slug: `nearby` }));
		const farOffline = await createOffering(
			page,
			createOfflineOffering({
				profileId: farUserId,
				title: `Far Offline`,
				slug: `far`,
			}),
		);
		const alwaysOnline = await createOffering(page, createOnlineOffering({ title: `Always Online`, slug: `online` }));
		const nearbyHybrid = await createOffering(
			page,
			createOfflineOffering({
				title: `Nearby Hybrid`,
				slug: `nearby-hybrid`,
				format: `offline+online`,
			}),
		);
		const farHybrid = await createOffering(
			page,
			createOfflineOffering({
				profileId: farUserId,
				title: `Far Hybrid`,
				slug: `far-hybrid`,
				format: `offline+online`,
			}),
		);

		await page.goto(`/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405&includeOnline=0`);
		await expect(offeringCardById(page, nearbyOffline.id)).toBeVisible();
		await expect(offeringCardById(page, nearbyHybrid.id)).toBeVisible();
		await expect(offeringCardById(page, farOffline.id)).toHaveCount(0);
		await expect(offeringCardById(page, farHybrid.id)).toHaveCount(0);
		await expect(offeringCardById(page, alwaysOnline.id)).toHaveCount(0);

		await page.goto(`/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405&includeOnline=1`);
		await expect(offeringCardById(page, nearbyOffline.id)).toBeVisible();
		await expect(offeringCardById(page, nearbyHybrid.id)).toBeVisible();
		await expect(offeringCardById(page, alwaysOnline.id)).toBeVisible();
		await expect(offeringCardById(page, farHybrid.id)).toBeVisible();
		await expect(offeringCardById(page, farOffline.id)).toHaveCount(0);
	});

	test("post-edit opens the offering in a dialog on the filtered list", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		const offering = await createOffering(
			page,
			createOfflineOffering({ title: `Edit Return Offering`, slug: `edit-return` }),
		);
		await signInAsE2EUser(page);
		const listUrl = `/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`;
		await page.goto(listUrl);
		await waitForClientHydration(page);

		await offeringCardById(page, offering.id).click();
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible();
		await dialog.getByTestId(`offering-edit-link`).click();
		await expect(page.getByTestId(`offering-edit-heading`)).toBeVisible();
		await page.getByTestId(`offering-title-input`).fill(`Edited Return Offering`);
		await page.getByTestId(`offering-save`).click();

		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`offering-title`)).toHaveText(`Edited Return Offering`);
		await expect(page).toHaveURL(new RegExp(`/offerings/${offering.slug}$`));
		await page.getByTestId(`dialog-close`).click();
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL(listUrl);
	});
});
