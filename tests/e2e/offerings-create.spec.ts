import { expect, test, type Page } from "@playwright/test";
import { signInAsE2EUser } from "./helpers/auth";
import {
	clearTestOfferings,
	clearTestProfiles,
	createCompleteProfile,
	createProfile,
	E2E_DEFAULT_USER_ID,
	E2E_OTP_CODE,
	getE2EUserIdForEmail,
	getOfferingBySlug,
	getProfileById,
} from "./helpers/seed";
import { chooseLocation, mockGooglePlacesAutocomplete, mockSupabaseOtpRequest, setGermanLocale } from "./helpers/offering-test-utils";

const anonymousNewEmail = `offering-new@example.com`;
const anonymousCompleteEmail = `offering-complete@example.com`;
const testProfileIds = [E2E_DEFAULT_USER_ID, getE2EUserIdForEmail(anonymousNewEmail), getE2EUserIdForEmail(anonymousCompleteEmail)];

test.describe("Offering creation", () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestOfferings(page);
		await clearTestProfiles(page, testProfileIds);
	});

	test.afterEach(async ({ page }) => {
		await clearTestOfferings(page);
		await clearTestProfiles(page, testProfileIds);
	});

	test("signed-in user creates an online offering with an image", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		await page.goto(`/offerings/new`);

		await fillOfferingBasics(page, { title: `E2E Online Mentoring`, format: `online` });
		await page.getByTestId(`offering-image-input`).setInputFiles(`static/pwa-192-maskable.png`);
		await expect(page.getByTestId(`offering-image-preview-item`)).toHaveCount(1);
		await expect(page.getByTestId(`offering-image-preview-remove`)).toBeEnabled({ timeout: 30000 });

		await clickWizardPrimary(page, /Angebot erstellen/i);
		await expect(page.getByText(`Angebot erstellt!`)).toBeVisible({ timeout: 15000 });
		const dialog = page.getByRole(`dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByRole(`heading`, { name: `E2E Online Mentoring` })).toBeVisible();

		const slug = getCreatedSlugFromUrl(page);
		await expect(page).toHaveURL(new RegExp(`/offerings/${slug}$`));
		const offering = await getOfferingBySlug(page, slug);
		expect(offering).toMatchObject({
			title: `E2E Online Mentoring`,
			format: `online`,
			profileId: E2E_DEFAULT_USER_ID,
			listed: true,
		});
		expect(offering.imageUrls).toHaveLength(1);
		expect(offering.imageUrls[0]).toContain(`/e2e/offerings/`);
	});

	test("signed-in user creates a hybrid offering with their profile location", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		await page.goto(`/offerings/new`);

		await fillOfferingBasics(page, { title: `E2E Hybrid Mentoring`, format: `offline+online` });
		await expect(page.locator(`#offering-form-location`)).toHaveValue(`Berlin`);
		await clickWizardPrimary(page, /Angebot erstellen/i);
		const dialog = page.getByRole(`dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByRole(`heading`, { name: `E2E Hybrid Mentoring`, level: 1 })).toBeVisible();

		const offering = await getOfferingBySlug(page, getCreatedSlugFromUrl(page));
		expect(offering).toMatchObject({
			title: `E2E Hybrid Mentoring`,
			format: `offline+online`,
			profileId: E2E_DEFAULT_USER_ID,
			listed: true,
		});
	});

	test("offline offering requires a selected location and then persists it", async ({ page }) => {
		await createProfile(page, createCompleteProfile({ locationLabel: null, latitude: null, longitude: null }));
		await signInAsE2EUser(page);
		await mockGooglePlacesAutocomplete(page);
		await page.goto(`/offerings/new`);

		await fillOfferingBasics(page, { title: `E2E Berlin Bodywork`, format: `offline` });
		await clickWizardPrimary(page, /Angebot erstellen/i);
		await expect(page.getByText(/Bitte wähle einen Ort aus den Vorschlägen/i)).toBeVisible();

		await chooseLocation(page, { inputId: `offering-form-location` });
		await clickWizardPrimary(page, /Angebot erstellen/i);
		const dialog = page.getByRole(`dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByRole(`heading`, { name: `E2E Berlin Bodywork`, level: 1 })).toBeVisible();
		expect(await getProfileById(page, E2E_DEFAULT_USER_ID)).toMatchObject({
			locationLabel: `Berlin`,
			latitude: 52.52,
			longitude: 13.405,
		});
	});

	test("signed-in incomplete profile enters the profile step and saves required public data", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				slug: null,
				displayName: null,
				bio: null,
				socialLinks: [],
			}),
		);
		await signInAsE2EUser(page);
		await page.goto(`/offerings/new`);

		await fillOfferingBasics(page, { title: `E2E Profile Completion`, format: `online` });
		await clickWizardPrimary(page, /Weiter/i);
		await expect(page.getByText(/Ein vollständiges Profil hilft/i)).toBeVisible();
		await page.locator(`[data-wizard-step="profile"] input[autocomplete="name"]`).fill(`Completed User`);
		await fillProfileBio(page, `Completed bio`);
		await addSocialLink(page);

		await clickWizardPrimary(page, /Angebot erstellen/i);
		await expect(page).not.toHaveURL(/\/offerings\/new/, { timeout: 15000 });
		const slug = getCreatedSlugFromUrl(page);
		expect((await getOfferingBySlug(page, slug)).title).toBe(`E2E Profile Completion`);
		const profile = await getProfileById(page, E2E_DEFAULT_USER_ID);
		expect(profile).toMatchObject({
			displayName: `Completed User`,
			slug: `completed-user`,
			socialLinks: [{ type: `website`, value: `https://example.com/e2e-user` }],
		});
		expect(profile.bio).toContain(`Completed bio`);
	});

	test("removing an invalid social link clears the validation error so the user can proceed", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				slug: null,
				displayName: null,
				bio: null,
				socialLinks: [],
			}),
		);
		await signInAsE2EUser(page);
		await page.goto(`/offerings/new`);

		await fillOfferingBasics(page, { title: `E2E Social Link Fix`, format: `online` });
		await clickWizardPrimary(page, /Weiter/i);
		await expect(page.getByText(/Ein vollständiges Profil hilft/i)).toBeVisible();
		await page.locator(`[data-wizard-step="profile"] input[autocomplete="name"]`).fill(`Social Fix User`);
		await fillProfileBio(page, `Social fix bio`);
		await addSocialLink(page, `not-a-domain`);

		await clickWizardPrimary(page, /Angebot erstellen/i);
		const websiteError = page.getByText(`Website ist keine gültige URL`);
		await expect(websiteError.first()).toBeVisible();

		await page.getByRole(`button`, { name: `Website entfernen` }).click();
		await expect(websiteError).toHaveCount(0);

		await clickWizardPrimary(page, /Angebot erstellen/i);
		await expect(page.getByText(`Bitte füge mindestens einen Social-Link hinzu.`)).toBeVisible();
		await expect(websiteError).toHaveCount(0);

		await addSocialLink(page, `https://example.com/social-fix`);
		await clickWizardPrimary(page, /Angebot erstellen/i);
		await expect(page).not.toHaveURL(/\/offerings\/new/, { timeout: 15000 });

		const profile = await getProfileById(page, E2E_DEFAULT_USER_ID);
		expect(profile).toMatchObject({
			displayName: `Social Fix User`,
			socialLinks: [{ type: `website`, value: `https://example.com/social-fix` }],
		});
	});

	test("anonymous new email completes profile, rejects an invalid OTP, then creates", async ({ page }) => {
		await mockSupabaseOtpRequest(page);
		await page.goto(`/offerings/new`);
		await fillOfferingBasics(page, { title: `E2E Anonymous Offering`, format: `online` });
		await page.getByPlaceholder(`deine@email.de`).fill(anonymousNewEmail);
		await clickWizardPrimary(page, /Weiter/i);

		await expect(page.getByText(/Ein vollständiges Profil hilft/i)).toBeVisible({
			timeout: 10000,
		});
		await page.locator(`[data-wizard-step="profile"] input[autocomplete="name"]`).fill(`Anonymous User`);
		await uploadRequiredProfileImages(page);
		await fillProfileBio(page, `Anonymous bio`);
		await addSocialLink(page);
		await clickWizardPrimary(page, /Weiter/i);

		await expect(page.getByRole(`heading`, { name: `E-Mail bestätigen` })).toBeVisible();
		await enterOtp(page, `000000`);
		await expect(page.getByText(`Der Code ist falsch oder abgelaufen.`)).toBeVisible();

		await enterOtp(page, E2E_OTP_CODE);
		await expect(page).not.toHaveURL(/\/offerings\/new/, { timeout: 15000 });
		const slug = getCreatedSlugFromUrl(page);
		expect((await getOfferingBySlug(page, slug)).title).toBe(`E2E Anonymous Offering`);
	});

	test("anonymous profile step shows social link errors on Weiter before OTP", async ({ page }) => {
		await mockSupabaseOtpRequest(page);
		await page.goto(`/offerings/new`);
		await fillOfferingBasics(page, { title: `E2E Social Preflight`, format: `online` });
		await page.getByPlaceholder(`deine@email.de`).fill(anonymousNewEmail);
		await clickWizardPrimary(page, /Weiter/i);

		await expect(page.getByText(/Ein vollständiges Profil hilft/i)).toBeVisible({
			timeout: 10000,
		});
		await page.locator(`[data-wizard-step="profile"] input[autocomplete="name"]`).fill(`Anonymous Preflight`);
		await uploadRequiredProfileImages(page);
		await fillProfileBio(page, `Anonymous preflight bio`);
		await addSocialLink(page, `not-a-domain`);

		await clickWizardPrimary(page, /Weiter/i);
		const websiteError = page.getByText(`Website ist keine gültige URL`);
		await expect(websiteError.first()).toBeVisible();
		await expect(page.getByRole(`heading`, { name: `E-Mail bestätigen` })).toHaveCount(0);

		await page.getByRole(`button`, { name: `Website entfernen` }).click();
		await expect(websiteError).toHaveCount(0);
		await addSocialLink(page, `https://example.com/preflight`);
		await clickWizardPrimary(page, /Weiter/i);

		await expect(page.getByRole(`heading`, { name: `E-Mail bestätigen` })).toBeVisible();
		await expect(websiteError).toHaveCount(0);
	});

	test("anonymous complete profile skips the profile step and creates after OTP", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				id: getE2EUserIdForEmail(anonymousCompleteEmail),
				slug: `anonymous-complete`,
				displayName: `Anonymous Complete`,
			}),
		);
		await mockSupabaseOtpRequest(page);
		await page.goto(`/offerings/new`);
		await fillOfferingBasics(page, { title: `E2E Existing Email Offering`, format: `online` });
		await page.getByPlaceholder(`deine@email.de`).fill(anonymousCompleteEmail);
		await clickWizardPrimary(page, /Weiter/i);

		await expect(page.getByRole(`heading`, { name: `E-Mail bestätigen` })).toBeVisible({
			timeout: 10000,
		});
		await expect(page.getByText(/Ein vollständiges Profil hilft/i)).toHaveCount(0);
		await enterOtp(page, E2E_OTP_CODE);
		await expect(page).not.toHaveURL(/\/offerings\/new/, { timeout: 15000 });
		const slug = getCreatedSlugFromUrl(page);
		expect((await getOfferingBySlug(page, slug)).title).toBe(`E2E Existing Email Offering`);
	});
});

async function fillOfferingBasics(page: Page, args: { title: string; format: `offline` | `online` | `offline+online` }) {
	await expect(page.getByRole(`heading`, { name: `Angebot erstellen` })).toBeVisible();
	await page.getByPlaceholder(`z.B. Private Couching Session`).fill(args.title);
	const radio = page.locator(`input[type="radio"][value="${args.format}"]`);
	await radio.locator(`xpath=ancestor::label`).click();
	await expect(radio).toBeChecked();
}

async function fillProfileBio(page: Page, text: string) {
	const bioEditor = page.locator(`[data-wizard-step="profile"] [contenteditable="true"]`);
	await bioEditor.click();
	await page.keyboard.press(`ControlOrMeta+A`);
	await page.keyboard.type(text);
	// Lexical syncs into the hidden field on a short debounce.
	await expect(page.locator(`[data-wizard-step="profile"] textarea`)).toHaveValue(new RegExp(text));
}

async function clickWizardPrimary(page: Page, name: RegExp) {
	await page.getByRole(`button`, { name }).click();
}

async function addSocialLink(page: Page, value = `https://example.com/e2e-user`) {
	await page.getByRole(`button`, { name: /Social-Link hinzufügen/i }).click();
	const dialog = page.getByRole(`dialog`, { name: /Link hinzufügen/i });
	await dialog.locator(`input:not([type="hidden"])`).last().fill(value);
	await dialog.getByRole(`button`, { name: `Hinzufügen` }).click();
	await expect(dialog).toBeHidden();
}

async function uploadRequiredProfileImages(page: Page) {
	const inputs = page.locator(`[data-wizard-step="profile"] input[type="file"]`);
	const count = await inputs.count();
	for (let index = 0; index < count; index++) {
		await inputs.nth(index).setInputFiles(`static/pwa-192-maskable.png`);
		await page.getByRole(`button`, { name: `Fertig` }).click();
	}
}

async function enterOtp(page: Page, code: string) {
	const otp = page.getByLabel(`Einmalcode`);
	await otp.click();
	await page.keyboard.press(`ControlOrMeta+A`);
	await page.keyboard.type(code);
}

function getCreatedSlugFromUrl(page: Page) {
	const url = new URL(page.url());
	const fromQuery = url.searchParams.get(`offeringSlug`)?.trim();
	if (fromQuery) return fromQuery;

	const pathSlug = url.pathname.replace(/\/+$/, ``).split(`/`).filter(Boolean).at(-1);
	if (pathSlug && pathSlug !== `offerings`) return pathSlug;

	throw new Error(`Could not resolve created offering slug from ${url.toString()}`);
}
