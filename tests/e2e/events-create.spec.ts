import { expect, test, type Page } from "@playwright/test";
import { signInAsE2EUser } from "./helpers/auth";
import {
	addSocialLink,
	clickWizardPrimary,
	enterOtp,
	fillEventDescription,
	fillProfileBio,
	uploadRequiredProfileImages,
} from "./helpers/create-flow";
import { chooseLocation, mockGooglePlacesAutocomplete, mockSupabaseOtpRequest, setGermanLocale } from "./helpers/offering-test-utils";
import {
	clearTestEvents,
	clearTestProfiles,
	createCompleteProfile,
	createProfile,
	E2E_DEFAULT_USER_ID,
	E2E_OTP_CODE,
	getE2EUserIdForEmail,
	getEventBySlug,
	getProfileById,
} from "./helpers/seed";

const anonymousNewEmail = `event-new@example.com`;
const anonymousCompleteEmail = `event-complete@example.com`;
const anonymousIncompleteEmail = `event-incomplete@example.com`;
const testProfileIds = [
	E2E_DEFAULT_USER_ID,
	getE2EUserIdForEmail(anonymousNewEmail),
	getE2EUserIdForEmail(anonymousCompleteEmail),
	getE2EUserIdForEmail(anonymousIncompleteEmail),
];

test.describe("Event creation", () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await clearTestEvents(page);
		await clearTestProfiles(page, testProfileIds);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
		await clearTestProfiles(page, testProfileIds);
	});

	test("logged-out homepage CTA opens the create form without a login dialog", async ({ page }) => {
		await page.goto(`/`);
		await page.locator(`[data-testid="create-offering"]:not([inert])`).click();
		await expect(page).toHaveURL(/\/events\/new/);
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `event`);
		await expect(page.getByTestId(`event-email-input`)).toBeVisible();
	});

	test("signed-in user with a complete profile creates an online event", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		await page.goto(`/events/new`);

		await fillEventBasics(page, { name: `E2E Online Event` });
		await clickWizardPrimary(page);

		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`event-title`)).toHaveText(`E2E Online Event`);

		const slug = getCreatedEventSlugFromUrl(page);
		const event = await getEventBySlug(page, slug);
		expect(event).toMatchObject({
			name: `E2E Online Event`,
			authorId: E2E_DEFAULT_USER_ID,
			attendanceMode: `online`,
		});
	});

	test("signed-in user creates an offline event with location autocomplete and a note", async ({ page }) => {
		await mockGooglePlacesAutocomplete(page);
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		await page.goto(`/events/new`);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `event`);
		await expect(page.getByTestId(`use-current-location-button`)).toHaveCount(0);
		await page.getByTestId(`event-name-input`).fill(`E2E Offline Event`);
		await fillEventDescription(page, `E2E event description`);
		await chooseLocation(page, { inputId: `event-location` });
		await page.getByTestId(`event-address-note-input`).fill(`3. Stock, Klingel 12`);
		await clickWizardPrimary(page);

		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`event-title`)).toHaveText(`E2E Offline Event`);
		await expect(dialog.getByTestId(`event-address-link`)).toContainText(`Berlin · Germany`);
		await expect(dialog.getByTestId(`event-address-link`)).toHaveAttribute(`href`, /query=52\.52,13\.405/);
		await expect(dialog.getByTestId(`event-address-note`)).toHaveText(`3. Stock, Klingel 12`);
		await expect(dialog.getByTestId(`event-address-link`)).not.toContainText(`3. Stock`);

		const event = await getEventBySlug(page, getCreatedEventSlugFromUrl(page));
		expect(event.name).toBe(`E2E Offline Event`);
		expect(event.authorId).toBe(E2E_DEFAULT_USER_ID);
		expect(event.attendanceMode).toBe(`offline`);
		expect(event.address).toEqual([`Berlin`, `Germany`]);
		expect(event.addressNote).toBe(`3. Stock, Klingel 12`);
		expect(event.latitude).toBeCloseTo(52.52, 3);
		expect(event.longitude).toBeCloseTo(13.405, 3);
	});

	test("signed-in user with a name skips the profile step even without social links", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				bio: null,
				socialLinks: [],
			}),
		);
		await signInAsE2EUser(page);
		await page.goto(`/events/new`);

		await fillEventBasics(page, { name: `E2E Partial Profile Event` });
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).not.toHaveAttribute(`data-step`, `profile`);
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		const event = await getEventBySlug(page, getCreatedEventSlugFromUrl(page));
		expect(event).toMatchObject({
			name: `E2E Partial Profile Event`,
			authorId: E2E_DEFAULT_USER_ID,
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
		await page.goto(`/events/new`);

		await fillEventBasics(page, { name: `E2E Profile Completion Event` });
		await clickWizardPrimary(page);
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`);
		await page.getByTestId(`profile-name-input`).fill(`Completed Host`);

		await clickWizardPrimary(page);
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		const slug = getCreatedEventSlugFromUrl(page);
		expect((await getEventBySlug(page, slug)).name).toBe(`E2E Profile Completion Event`);
		const profile = await getProfileById(page, E2E_DEFAULT_USER_ID);
		expect(profile).toMatchObject({
			displayName: `Completed Host`,
			slug: `completed-host`,
		});
	});

	test("anonymous new email completes profile, rejects an invalid OTP, then creates", async ({ page }) => {
		await mockSupabaseOtpRequest(page);
		await page.goto(`/events/new`);
		await fillEventBasics(page, { name: `E2E Anonymous Event` });
		await page.getByTestId(`event-email-input`).fill(anonymousNewEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`, {
			timeout: 10000,
		});
		await page.getByTestId(`profile-name-input`).fill(`Anonymous Host`);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`);
		await enterOtp(page, `000000`);
		await expect(page.getByText(`Der Code ist falsch oder abgelaufen.`)).toBeVisible();

		await enterOtp(page, E2E_OTP_CODE);
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		const slug = getCreatedEventSlugFromUrl(page);
		const event = await getEventBySlug(page, slug);
		expect(event.name).toBe(`E2E Anonymous Event`);
		expect(event.authorId).toBe(getE2EUserIdForEmail(anonymousNewEmail));
	});

	test("anonymous profile step shows social link errors on Weiter before OTP", async ({ page }) => {
		await mockSupabaseOtpRequest(page);
		await page.goto(`/events/new`);
		await fillEventBasics(page, { name: `E2E Social Preflight Event` });
		await page.getByTestId(`event-email-input`).fill(anonymousNewEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`, {
			timeout: 10000,
		});
		await page.getByTestId(`profile-name-input`).fill(`Anonymous Preflight`);
		await uploadRequiredProfileImages(page);
		await fillProfileBio(page, `Anonymous preflight bio`);
		await addSocialLink(page, `not-a-domain`);

		await clickWizardPrimary(page);
		const websiteError = page.getByText(`Website is not a valid URL`);
		await expect(websiteError.first()).toBeVisible();
		await expect(page.getByTestId(`create-event-heading`)).not.toHaveAttribute(`data-step`, `otp`);

		await page.getByTestId(`remove-social-link`).click();
		await expect(websiteError).toHaveCount(0);
		await addSocialLink(page, `https://example.com/preflight`);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`);
		await expect(websiteError).toHaveCount(0);
	});

	test("anonymous complete profile skips the profile step and creates after OTP", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				id: getE2EUserIdForEmail(anonymousCompleteEmail),
				slug: `anonymous-event-complete`,
				displayName: `Anonymous Event Complete`,
			}),
		);
		await mockSupabaseOtpRequest(page);
		await page.goto(`/events/new`);
		await fillEventBasics(page, { name: `E2E Existing Email Event` });
		await page.getByTestId(`event-email-input`).fill(anonymousCompleteEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await expect(page.getByTestId(`create-event-heading`)).not.toHaveAttribute(`data-step`, `profile`);
		await enterOtp(page, E2E_OTP_CODE);
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		const slug = getCreatedEventSlugFromUrl(page);
		const event = await getEventBySlug(page, slug);
		expect(event.name).toBe(`E2E Existing Email Event`);
		expect(event.authorId).toBe(getE2EUserIdForEmail(anonymousCompleteEmail));
	});

	test("anonymous existing email with a name skips the profile step even without social links", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				id: getE2EUserIdForEmail(anonymousCompleteEmail),
				slug: `anonymous-event-named`,
				displayName: `Named Without Social`,
				bio: null,
				socialLinks: [],
			}),
		);
		await mockSupabaseOtpRequest(page);
		await page.goto(`/events/new`);
		await fillEventBasics(page, { name: `E2E Named No Social Event` });
		await page.getByTestId(`event-email-input`).fill(anonymousCompleteEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await expect(page.getByTestId(`create-event-heading`)).not.toHaveAttribute(`data-step`, `profile`);
		await enterOtp(page, E2E_OTP_CODE);
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		expect((await getEventBySlug(page, getCreatedEventSlugFromUrl(page))).name).toBe(`E2E Named No Social Event`);
	});

	test("anonymous incomplete existing email adds to the profile then creates after OTP", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				id: getE2EUserIdForEmail(anonymousIncompleteEmail),
				slug: null,
				displayName: null,
				bio: null,
				socialLinks: [],
			}),
		);
		await mockSupabaseOtpRequest(page);
		await page.goto(`/events/new`);
		await fillEventBasics(page, { name: `E2E Incomplete Email Event` });
		await page.getByTestId(`event-email-input`).fill(anonymousIncompleteEmail);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`, {
			timeout: 10000,
		});
		await page.getByTestId(`profile-name-input`).fill(`Returning Host`);
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`);
		await enterOtp(page, E2E_OTP_CODE);
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });

		const userId = getE2EUserIdForEmail(anonymousIncompleteEmail);
		const event = await getEventBySlug(page, getCreatedEventSlugFromUrl(page));
		expect(event).toMatchObject({
			name: `E2E Incomplete Email Event`,
			authorId: userId,
		});
		const profile = await getProfileById(page, userId);
		expect(profile).toMatchObject({
			displayName: `Returning Host`,
		});
	});
});

async function fillEventBasics(page: Page, args: { name: string }) {
	await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `event`);
	await page.getByTestId(`event-name-input`).fill(args.name);
	await page.getByTestId(`event-online-checkbox`).check();
	await fillEventDescription(page, `E2E event description`);
}

function getCreatedEventSlugFromUrl(page: Page) {
	const url = new URL(page.url());
	const fromQuery = url.searchParams.get(`eventSlug`)?.trim();
	if (fromQuery) return fromQuery;

	const pathSlug = url.pathname.replace(/^\//, ``).trim();
	if (pathSlug && pathSlug !== `events/new` && !pathSlug.startsWith(`events/`)) return pathSlug;

	throw new Error(`Could not resolve created event slug from ${url.toString()}`);
}
