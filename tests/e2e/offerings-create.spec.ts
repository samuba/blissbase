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
		await page.addInitScript(() => {
			try {
				Reflect.deleteProperty(window, `navigation`);
			} catch {
				// Fall through to shadowing a non-configurable descriptor.
			}
			if (typeof window.navigation === `undefined`) return;

			try {
				Object.defineProperty(window, `navigation`, {
					configurable: true,
					value: undefined,
				});
			} catch {
				try {
					Reflect.set(window, `navigation`, undefined);
				} catch {
					// The assertion below reports browsers where neither override works.
				}
			}
		});
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		await page.goto(`/offerings/new`);
		expect(await page.evaluate(() => typeof window.navigation)).toBe(`undefined`);

		await fillOfferingBasics(page, { title: `E2E Online Mentoring`, format: `online` });
		await page.getByTestId(`offering-image-input`).setInputFiles(`static/pwa-192-maskable.png`);
		await expect(page.getByTestId(`offering-image-preview-item`)).toHaveCount(1);
		await expect(page.getByTestId(`offering-image-preview-remove`)).toBeEnabled({ timeout: 30000 });

		await clickWizardPrimary(page);
		await expect(page.getByText(`Angebot erstellt!`)).toBeVisible({ timeout: 15000 });
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`offering-title`)).toHaveText(`E2E Online Mentoring`);

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

		const offeringsHostUrl = new URL(`/offerings`, page.url()).href;
		await page.getByTestId(`dialog-close`).click();
		await expect(dialog).toBeHidden();
		await expect(page).toHaveURL(offeringsHostUrl);
	});

	test("signed-in user creates a hybrid offering with their profile location", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		await page.goto(`/offerings/new`);

		await fillOfferingBasics(page, { title: `E2E Hybrid Mentoring`, format: `offline+online` });
		await expect(page.getByTestId(`offering-form-location`)).toHaveValue(`Berlin`);
		await clickWizardPrimary(page);
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`offering-title`)).toHaveText(`E2E Hybrid Mentoring`);

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
		await clickWizardPrimary(page);
		await expect(page.getByText(/Please select a location from the suggestions/i)).toBeVisible();

		await chooseLocation(page, { inputId: `offering-form-location` });
		await clickWizardPrimary(page);
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`offering-title`)).toHaveText(`E2E Berlin Bodywork`);
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
		await clickWizardPrimary(page);
		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `profile`);
		await page.getByTestId(`profile-name-input`).fill(`Completed User`);
		await fillProfileBio(page, `Completed bio`);
		await addSocialLink(page);

		await clickWizardPrimary(page);
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
		await clickWizardPrimary(page);
		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `profile`);
		await page.getByTestId(`profile-name-input`).fill(`Social Fix User`);
		await fillProfileBio(page, `Social fix bio`);
		await addSocialLink(page, `not-a-domain`);

		await clickWizardPrimary(page);
		const websiteError = page.getByText(`Website is not a valid URL`);
		await expect(websiteError.first()).toBeVisible();

		await page.getByTestId(`remove-social-link`).click();
		await expect(websiteError).toHaveCount(0);

		await clickWizardPrimary(page);
		await expect(page.getByText(`Bitte füge mindestens einen Social-Link hinzu.`)).toBeVisible();
		await expect(websiteError).toHaveCount(0);

		await addSocialLink(page, `https://example.com/social-fix`);
		await clickWizardPrimary(page);
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
		await page.getByTestId(`offering-email-input`).fill(anonymousNewEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `profile`, {
			timeout: 10000,
		});
		await page.getByTestId(`profile-name-input`).fill(`Anonymous User`);
		await uploadRequiredProfileImages(page);
		await fillProfileBio(page, `Anonymous bio`);
		await addSocialLink(page);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `otp`);
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
		await page.getByTestId(`offering-email-input`).fill(anonymousNewEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `profile`, {
			timeout: 10000,
		});
		await page.getByTestId(`profile-name-input`).fill(`Anonymous Preflight`);
		await uploadRequiredProfileImages(page);
		await fillProfileBio(page, `Anonymous preflight bio`);
		await addSocialLink(page, `not-a-domain`);

		await clickWizardPrimary(page);
		const websiteError = page.getByText(`Website is not a valid URL`);
		await expect(websiteError.first()).toBeVisible();
		await expect(page.getByTestId(`offering-wizard-heading`)).not.toHaveAttribute(`data-step`, `otp`);

		await page.getByTestId(`remove-social-link`).click();
		await expect(websiteError).toHaveCount(0);
		await addSocialLink(page, `https://example.com/preflight`);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `otp`);
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
		await page.getByTestId(`offering-email-input`).fill(anonymousCompleteEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await expect(page.getByTestId(`offering-wizard-heading`)).not.toHaveAttribute(`data-step`, `profile`);
		await enterOtp(page, E2E_OTP_CODE);
		await expect(page).not.toHaveURL(/\/offerings\/new/, { timeout: 15000 });
		const slug = getCreatedSlugFromUrl(page);
		expect((await getOfferingBySlug(page, slug)).title).toBe(`E2E Existing Email Offering`);
	});
});

async function fillOfferingBasics(page: Page, args: { title: string; format: `offline` | `online` | `offline+online` }) {
	await expect(page.getByTestId(`offering-wizard-heading`)).toHaveAttribute(`data-step`, `offering`);
	await page.getByTestId(`offering-title-input`).fill(args.title);
	await page.getByTestId(`offering-format-${args.format}`).click();
	await expect(page.getByTestId(`offering-format-${args.format}`).locator(`input`)).toBeChecked();
}

async function fillProfileBio(page: Page, text: string) {
	const bioEditor = page.getByTestId(`profile-bio-editor`).locator(`[contenteditable="true"]`);
	await bioEditor.click();
	await page.keyboard.press(`ControlOrMeta+A`);
	await page.keyboard.type(text);
	await expect(page.getByTestId(`profile-bio-editor`).locator(`textarea`)).toHaveValue(new RegExp(text));
}

async function clickWizardPrimary(page: Page) {
	await page.getByTestId(`wizard-primary`).click();
}

async function addSocialLink(page: Page, value = `https://example.com/e2e-user`) {
	await page.getByTestId(`add-social-link`).click();
	const dialog = page.getByTestId(`add-social-link-dialog`);
	await dialog.getByTestId(`add-social-link-value`).fill(value);
	await dialog.getByTestId(`add-social-link-submit`).click();
	await expect(dialog).toBeHidden();
}

async function uploadRequiredProfileImages(page: Page) {
	for (const kind of [`profile`, `banner`]) {
		const crop = page.getByTestId(`${kind}-image-crop`);
		if (await crop.evaluate((el) => el.classList.contains(`hidden`))) continue;
		await page.getByTestId(`${kind}-image-file`).setInputFiles(`static/pwa-192-maskable.png`);
		await page.getByTestId(`${kind}-crop-done`).click();
		await expect(page.getByTestId(`${kind}-image-file`)).toBeEnabled({ timeout: 30000 });
	}
}

async function enterOtp(page: Page, code: string) {
	const otp = page.getByTestId(`otp-input`);
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
