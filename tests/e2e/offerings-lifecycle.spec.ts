import { expect, test } from "@playwright/test";
import { signInAsE2EUser } from "./helpers/auth";
import {
	clearTestOfferings,
	clearTestProfiles,
	createCompleteProfile,
	createOffering,
	createOfflineOffering,
	createOtherCompleteProfile,
	createProfile,
	E2E_DEFAULT_USER_ID,
	E2E_OTHER_USER_EMAIL,
	E2E_OTHER_USER_ID,
	getOfferingById,
	getProfileById,
} from "./helpers/seed";
import { chooseLocation, mockGooglePlacesAutocomplete, setGermanLocale, waitForClientHydration } from "./helpers/offering-test-utils";

const profileIds = [E2E_DEFAULT_USER_ID, E2E_OTHER_USER_ID];

test.describe("Offering lifecycle and access control", () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestOfferings(page);
		await clearTestProfiles(page, profileIds);
		await createProfile(page, createCompleteProfile());
		await createProfile(page, createOtherCompleteProfile());
	});

	test.afterEach(async ({ page }) => {
		await clearTestOfferings(page);
		await clearTestProfiles(page, profileIds);
	});

	test("owner edits fields and removes, reorders, and adds images", async ({ page }) => {
		const existingImages = [
			`https://assets.blissbase.app/e2e/existing/one.webp`,
			`https://assets.blissbase.app/e2e/existing/two.webp`,
			`https://assets.blissbase.app/e2e/existing/three.webp`,
		];
		const offering = await createOffering(
			page,
			createOfflineOffering({
				title: `Editable Offering`,
				slug: `editable`,
				imageUrls: existingImages,
			}),
		);
		await signInAsE2EUser(page);
		await page.goto(`/offerings/${offering.slug}/edit`);
		await expect(page.getByRole(`heading`, { name: `Angebot bearbeiten` })).toBeVisible();
		await expect(page.getByTestId(`offering-image-preview-item`)).toHaveCount(3);

		await page.getByTestId(`offering-image-input`).setInputFiles(`static/pwa-192-maskable.png`);
		await expect(page.getByTestId(`offering-image-preview-item`)).toHaveCount(4);
		await expect(page.getByTestId(`offering-image-preview-remove`).last()).toBeEnabled({
			timeout: 30000,
		});
		await page.getByTestId(`offering-image-preview-remove`).nth(1).click();
		await page.getByRole(`button`, { name: `Bild #1 nach rechts verschieben` }).press(`Enter`);
		await expect(page.getByTestId(`offering-image-preview-item`)).toHaveCount(3);
		await expect(page.getByTestId(`offering-image-preview-item`).first()).toContainText(`Bild #3`);
		await page.getByPlaceholder(`z.B. Private Couching Session`).fill(`Edited Offering`);
		await page.getByRole(`button`, { name: `Speichern`, exact: true }).click();

		await expect(page.getByText(`Angebot wurde aktualisiert.`)).toBeVisible({ timeout: 15000 });
		const persisted = await getOfferingById(page, offering.id);
		expect(persisted.title).toBe(`Edited Offering`);
		expect(persisted.imageUrls.slice(0, 2)).toEqual([existingImages[2], existingImages[0]]);
		expect(persisted.imageUrls).toHaveLength(3);
		expect(persisted.imageUrls[2]).toContain(`/e2e/offerings/`);
	});

	test("owner changes the shared location while editing an offline offering", async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Relocatable Offering`, slug: `relocatable` }));
		await signInAsE2EUser(page);
		await mockGooglePlacesAutocomplete(page);
		await page.goto(`/offerings/${offering.slug}/edit`);

		await chooseLocation(page, {
			inputId: `offering-form-location`,
			query: `Mun`,
			option: `Munich, Germany`,
		});
		await page.getByRole(`button`, { name: `Speichern`, exact: true }).click();
		await expect(page.getByText(`Angebot wurde aktualisiert.`)).toBeVisible({ timeout: 15000 });
		expect(await getProfileById(page, E2E_DEFAULT_USER_ID)).toMatchObject({
			locationLabel: `Munich`,
			latitude: 48.137,
			longitude: 11.575,
		});
	});

	test("switching an online offering to offline requires a location", async ({ page }) => {
		await createProfile(page, createCompleteProfile({ locationLabel: null, latitude: null, longitude: null }));
		const offering = await createOffering(
			page,
			createOfflineOffering({
				title: `Location Required Offering`,
				slug: `location-required`,
				format: `online`,
			}),
		);
		await signInAsE2EUser(page);
		await page.goto(`/offerings/${offering.slug}/edit`);

		const offlineRadio = page.locator(`input[type="radio"][value="offline"]`);
		await offlineRadio.locator(`xpath=ancestor::label`).click();
		await expect(offlineRadio).toBeChecked();
		await page.getByRole(`button`, { name: `Speichern`, exact: true }).click();

		await expect(page.getByText(`Bitte wähle einen Ort für dein Angebot aus.`).first()).toBeVisible();
		await expect(page).toHaveURL(`/offerings/${offering.slug}/edit`);
		expect((await getOfferingById(page, offering.id)).format).toBe(`online`);
	});

	test("non-owner cannot open the edit route", async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Protected Offering`, slug: `protected` }));
		await signInAsE2EUser(page, {
			userId: E2E_OTHER_USER_ID,
			email: E2E_OTHER_USER_EMAIL,
		});
		const response = await page.goto(`/offerings/${offering.slug}/edit`);
		expect(response?.status()).toBe(403);
	});

	test("owner deactivates and reactivates an offering across public discovery", async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Lifecycle Offering`, slug: `lifecycle` }));
		await signInAsE2EUser(page);
		await page.goto(`/offerings/${offering.slug}/edit`);
		await expect(page.getByTestId(`offering-image-input`)).toBeAttached();
		await page.getByRole(`button`, { name: `Deaktivieren`, exact: true }).click();
		await expect(page.getByRole(`button`, { name: `Aktivieren`, exact: true })).toBeVisible();
		await expect.poll(async () => (await getOfferingById(page, offering.id)).listed).toBe(false);

		const listUrl = `/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405`;
		await page.goto(listUrl);
		await expect(page.getByRole(`heading`, { name: `Lifecycle Offering` })).toBeVisible();
		await expect(page.getByText(`Deaktiviert — nicht für andere sichtbar`)).toBeVisible();

		await page.context().clearCookies();
		await setGermanLocale(page);
		await page.goto(listUrl);
		await expect(page.getByRole(`heading`, { name: `Lifecycle Offering` })).toHaveCount(0);

		await signInAsE2EUser(page);
		await setGermanLocale(page);
		await page.goto(`/offerings/${offering.slug}`);
		await expect(page.getByRole(`heading`, { name: `Lifecycle Offering` })).toBeVisible();
		await page.getByRole(`button`, { name: `Aktivieren`, exact: true }).click();
		await expect.poll(async () => (await getOfferingById(page, offering.id)).listed).toBe(true);

		await page.goto(listUrl);
		await expect(page.getByRole(`heading`, { name: `Lifecycle Offering` })).toBeVisible();
		await expect(page.getByText(`Deaktiviert — nicht für andere sichtbar`)).toHaveCount(0);
	});

	test("profile offerings tabs separate active and inactive offerings", async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Active Profile Offering`, slug: `profile-active` }));
		await signInAsE2EUser(page);
		await page.goto(`/profile/offerings`);
		await waitForClientHydration(page);

		await expect(page.getByRole(`heading`, { name: `Active Profile Offering` })).toBeVisible();
		await page.locator(`[data-offering-id="${offering.id}"]`).click();
		await expect(page.getByRole(`dialog`)).toBeVisible();
		await expect(page).toHaveURL(`/offerings/${offering.slug}`);
		await page.getByRole(`dialog`).getByRole(`link`, { name: `Bearbeiten` }).click();
		await expect(page.getByRole(`dialog`)).toHaveCount(0);
		await expect(page.getByTestId(`offering-image-input`)).toBeAttached();
		const deactivateButton = page.getByRole(`button`, { name: `Deaktivieren`, exact: true });
		await expect(deactivateButton).toBeEnabled();
		await deactivateButton.click();
		await expect(page.getByRole(`button`, { name: `Aktivieren`, exact: true })).toBeVisible();
		await expect.poll(async () => (await getOfferingById(page, offering.id)).listed).toBe(false);

		await page.goto(`/profile/offerings`);
		await waitForClientHydration(page);
		await page.getByRole(`tab`, { name: `Deaktiviert` }).click();
		await expect(page.getByRole(`heading`, { name: `Active Profile Offering` })).toBeVisible();
	});

	test("anonymous users cannot view an unlisted offering but its owner can", async ({ page }) => {
		const offering = await createOffering(
			page,
			createOfflineOffering({
				title: `Private Owner Offering`,
				slug: `private-owner`,
				listed: false,
			}),
		);
		const anonymousResponse = await page.goto(`/offerings/${offering.slug}`);
		expect(anonymousResponse?.status()).toBe(404);

		await signInAsE2EUser(page);
		const ownerResponse = await page.goto(`/offerings/${offering.slug}`);
		expect(ownerResponse?.status()).toBe(200);
		await expect(page.getByRole(`heading`, { name: `Private Owner Offering` })).toBeVisible();
	});

	test("owner confirms deletion and the offering disappears from persistence and discovery", async ({ page }) => {
		const offering = await createOffering(page, createOfflineOffering({ title: `Delete Offering`, slug: `delete` }));
		await signInAsE2EUser(page);
		await page.goto(`/offerings/${offering.slug}/edit`);
		await expect(page.getByTestId(`offering-image-input`)).toBeAttached();
		page.once(`dialog`, (dialog) => void dialog.accept());
		await Promise.all([
			page.waitForURL((url) => url.pathname === `/offerings`),
			page.getByRole(`button`, { name: `Löschen`, exact: true }).click(),
		]);

		await expect.poll(async () => await getOfferingById(page, offering.id)).toBeUndefined();
		await expect(page.getByRole(`heading`, { name: `Delete Offering` })).toHaveCount(0);
	});
});
