import { expect, test, type Page } from "@playwright/test";
import { signInAsE2EUser } from "./helpers/auth";
import {
	addSocialLink,
	clickWizardPrimary,
	enterOtp,
	expectCreateFlowPublishing,
	fillEventDescription,
	fillProfileBio,
	sendCreateFlowOtp,
	uploadRequiredProfileImages,
} from "./helpers/create-flow";
import { chooseLocation, mockGooglePlacesAutocomplete, mockSupabaseOtpRequest, setGermanLocale } from "./helpers/offering-test-utils";
import {
	clearTestEvents,
	clearTestProfiles,
	createCompleteProfile,
	createIncompleteProfile,
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
		await expect(page.getByTestId(`event-email-input`)).toHaveCount(0);
		await expect(page.getByTestId(`google-login-button`)).toHaveCount(0);
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

		const slug = await getCreatedEventSlugFromUrl(page);
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
		await expect(dialog.getByTestId(`event-address-link`)).toHaveAttribute(`href`, /query=Berlin%2C%20Germany/);
		await expect(dialog.getByTestId(`event-address-note`)).toHaveText(`3. Stock, Klingel 12`);
		await expect(dialog.getByTestId(`event-address-link`)).not.toContainText(`3. Stock`);

		const event = await getEventBySlug(page, await getCreatedEventSlugFromUrl(page));
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
		const event = await getEventBySlug(page, await getCreatedEventSlugFromUrl(page));
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
		const slug = await getCreatedEventSlugFromUrl(page);
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
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await sendCreateFlowOtp(page, { email: anonymousNewEmail, emailTestId: `event-email-input` });
		await enterOtp(page, `000000`);
		await expect(page.getByText(`Der Code ist falsch oder abgelaufen.`)).toBeVisible();

		await enterOtp(page, E2E_OTP_CODE);
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`, {
			timeout: 10000,
		});
		await page.getByTestId(`profile-name-input`).fill(`Anonymous Host`);
		await clickWizardPrimary(page);

		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		const slug = await getCreatedEventSlugFromUrl(page);
		const event = await getEventBySlug(page, slug);
		expect(event.name).toBe(`E2E Anonymous Event`);
		expect(event.authorId).toBe(getE2EUserIdForEmail(anonymousNewEmail));
	});

	test("anonymous profile step shows social link errors on Weiter after OTP", async ({ page }) => {
		await mockSupabaseOtpRequest(page);
		await page.goto(`/events/new`);
		await fillEventBasics(page, { name: `E2E Social Preflight Event` });
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await sendCreateFlowOtp(page, { email: anonymousNewEmail, emailTestId: `event-email-input` });
		await enterOtp(page, E2E_OTP_CODE);

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
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`);

		await page.getByTestId(`remove-social-link`).click();
		await expect(websiteError).toHaveCount(0);
		await addSocialLink(page, `https://example.com/preflight`);
		await clickWizardPrimary(page);

		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
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
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await expect(page.getByTestId(`google-login-button`)).toBeVisible();
		await sendCreateFlowOtp(page, { email: anonymousCompleteEmail, emailTestId: `event-email-input` });
		await enterOtp(page, E2E_OTP_CODE);
		await expectCreateFlowPublishing(page);
		await expect(page.getByTestId(`create-event-heading`)).not.toBeVisible();
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		const slug = await getCreatedEventSlugFromUrl(page);
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
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await sendCreateFlowOtp(page, { email: anonymousCompleteEmail, emailTestId: `event-email-input` });
		await enterOtp(page, E2E_OTP_CODE);
		await expectCreateFlowPublishing(page);
		await expect(page.getByTestId(`create-event-heading`)).not.toBeVisible();
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		expect((await getEventBySlug(page, await getCreatedEventSlugFromUrl(page))).name).toBe(`E2E Named No Social Event`);
	});

	test("restores an event draft after Google sign-in and creates it", async ({ page }) => {
		await createProfile(page, createCompleteProfile());
		await signInAsE2EUser(page);
		const startAt = futureLocalDateTime();
		await page.goto(`/`);
		await page.evaluate((start) => {
			const draft = {
				v: 1,
				kind: `event`,
				savedAt: Date.now(),
				requestedStep: `otp`,
				email: `google-host@example.com`,
				socialLinks: [],
				fields: {
					name: `E2E Google Event`,
					description: `<p>E2E event description</p>`,
					tagSlugs: [],
					price: ``,
					address: ``,
					addressNote: ``,
					latitude: ``,
					longitude: ``,
					startAt: start,
					endAt: ``,
					timeZone: `Europe/Berlin`,
					isOnline: true,
					isNotListed: false,
					contact: ``,
					contactMethod: `none`,
					email: `google-host@example.com`,
					profile: {
						displayName: ``,
						bio: ``,
						profileImageUrl: ``,
						bannerImageUrl: ``,
						locationLabel: ``,
						latitude: ``,
						longitude: ``,
					},
				},
			};
			sessionStorage.setItem(`blissbase:create-draft:event`, JSON.stringify(draft));
			sessionStorage.setItem(`blissbase:create-draft:event:pending`, `1`);
		}, startAt);
		await page.goto(`/events/new?auth_success=1`);
		await expect(page.getByText(`Du bist jetzt angemeldet. Viel Spaß!`)).toHaveCount(0);
		await expect(page.getByText(`Event erstellt!`)).toBeVisible({ timeout: 15000 });
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });
		const dialog = page.getByTestId(`details-dialog`);
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId(`event-title`)).toHaveText(`E2E Google Event`);
		expect((await getEventBySlug(page, await getCreatedEventSlugFromUrl(page))).name).toBe(`E2E Google Event`);
		await page.goto(`/events/new`);
		await expect(page.getByTestId(`event-name-input`)).toHaveValue(``);
	});

	test("Google sign-in persists the typed event description", async ({ page }) => {
		const drafts: string[] = [];
		await page.exposeBinding(`e2eCaptureEventDraft`, (_source, value) => {
			drafts.push(String(value));
		});
		await page.addInitScript(() => {
			const originalSetItem = Storage.prototype.setItem;
			Storage.prototype.setItem = function setItem(key, value) {
				originalSetItem.call(this, key, value);
				if (key === `blissbase:create-draft:event`) {
					const capture = window[`e2eCaptureEventDraft`];
					if (typeof capture === `function`) capture(value);
				}
			};
		});
		await page.route(`**/auth/v1/**`, async (route) => {
			if (route.request().url().includes(`/authorize`)) {
				await route.abort();
				return;
			}
			await route.continue();
		});
		await page.goto(`/events/new`);
		await fillEventBasics(page, { name: `E2E Google Draft Event` });
		await clickWizardPrimary(page);
		await expect(page.getByTestId(`google-login-button`)).toBeVisible({ timeout: 10000 });
		await page.getByTestId(`google-login-button`).click();
		await expect
			.poll(() => {
				const raw = drafts.at(-1) ?? ``;
				if (!raw) return ``;
				try {
					return String(JSON.parse(raw).fields?.description ?? ``);
				} catch {
					return ``;
				}
			})
			.toContain(`E2E event description`);
	});

	test("Google resume with an incomplete profile shows the profile step", async ({ page }) => {
		await createProfile(page, createIncompleteProfile());
		await signInAsE2EUser(page);
		const startAt = futureLocalDateTime();
		await page.goto(`/`);
		await page.evaluate((start) => {
			const draft = {
				v: 1,
				kind: `event`,
				savedAt: Date.now(),
				requestedStep: `otp`,
				email: `google-host@example.com`,
				socialLinks: [],
				fields: {
					name: `E2E Google Incomplete Event`,
					description: `<p>E2E event description</p>`,
					tagSlugs: [],
					price: ``,
					address: ``,
					addressNote: ``,
					latitude: ``,
					longitude: ``,
					startAt: start,
					endAt: ``,
					timeZone: `Europe/Berlin`,
					isOnline: true,
					isNotListed: false,
					contact: ``,
					contactMethod: `none`,
					email: `google-host@example.com`,
					profile: {
						displayName: ``,
						bio: ``,
						profileImageUrl: ``,
						bannerImageUrl: ``,
						locationLabel: ``,
						latitude: ``,
						longitude: ``,
					},
				},
			};
			sessionStorage.setItem(`blissbase:create-draft:event`, JSON.stringify(draft));
			sessionStorage.setItem(`blissbase:create-draft:event:pending`, `1`);
		}, startAt);
		await page.goto(`/events/new?auth_success=1`);
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`, { timeout: 10000 });
		await expect(page.getByTestId(`event-name-input`)).toBeHidden();
		await page.getByTestId(`profile-name-input`).fill(`Google Host`);
		await clickWizardPrimary(page);
		await expect(page.getByText(`Event erstellt!`)).toBeVisible({ timeout: 15000 });
		expect((await getEventBySlug(page, await getCreatedEventSlugFromUrl(page))).name).toBe(`E2E Google Incomplete Event`);
	});

	test("OAuth error restores the event draft on the auth step", async ({ page }) => {
		await page.goto(`/`);
		await page.evaluate(() => {
			const date = new Date();
			date.setDate(date.getDate() + 2);
			date.setHours(12, 0, 0, 0);
			const start = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, `0`)}-${String(date.getDate()).padStart(2, `0`)}T12:00`;
			const draft = {
				v: 1,
				kind: `event`,
				savedAt: Date.now(),
				requestedStep: `otp`,
				email: `google-host@example.com`,
				socialLinks: [],
				fields: {
					name: `E2E Google Cancelled Event`,
					description: `<p>E2E event description</p>`,
					tagSlugs: [],
					price: ``,
					address: ``,
					addressNote: ``,
					latitude: ``,
					longitude: ``,
					startAt: start,
					endAt: ``,
					timeZone: `Europe/Berlin`,
					isOnline: true,
					isNotListed: false,
					contact: ``,
					contactMethod: `none`,
					email: `google-host@example.com`,
					profile: {
						displayName: ``,
						bio: ``,
						profileImageUrl: ``,
						bannerImageUrl: ``,
						locationLabel: ``,
						latitude: ``,
						longitude: ``,
					},
				},
			};
			sessionStorage.setItem(`blissbase:create-draft:event`, JSON.stringify(draft));
			sessionStorage.setItem(`blissbase:create-draft:event:pending`, `1`);
		});
		await page.goto(`/events/new?auth_error=access_denied`);
		await expect(page.getByText(`Anmeldung fehlgeschlagen`)).toBeVisible();
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, { timeout: 10000 });
		await page.getByRole(`button`, { name: `Zurück` }).click();
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `event`);
		await expect(page.getByTestId(`event-name-input`)).toHaveValue(`E2E Google Cancelled Event`);
		await expect(page.getByTestId(`event-description-editor`).locator(`textarea`)).toHaveValue(/E2E event description/);
	});

	test("returning to the create form restores a leftover draft on the event step", async ({ page }) => {
		const startAt = futureLocalDateTime();
		await page.goto(`/`);
		await page.evaluate((start) => {
			const draft = {
				v: 1,
				kind: `event`,
				savedAt: Date.now(),
				requestedStep: `otp`,
				email: `google-host@example.com`,
				socialLinks: [],
				fields: {
					name: `E2E Returning Draft Event`,
					description: `<p>E2E event description</p>`,
					tagSlugs: [],
					price: ``,
					address: ``,
					addressNote: ``,
					latitude: ``,
					longitude: ``,
					startAt: start,
					endAt: ``,
					timeZone: `Europe/Berlin`,
					isOnline: true,
					isNotListed: false,
					contact: ``,
					contactMethod: `none`,
					email: `google-host@example.com`,
					profile: {
						displayName: ``,
						bio: ``,
						profileImageUrl: ``,
						bannerImageUrl: ``,
						locationLabel: ``,
						latitude: ``,
						longitude: ``,
					},
				},
			};
			sessionStorage.setItem(`blissbase:create-draft:event`, JSON.stringify(draft));
			sessionStorage.setItem(`blissbase:create-draft:event:pending`, `1`);
		}, startAt);
		await page.goto(`/events/new`);
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `event`, { timeout: 10000 });
		await expect(page.getByTestId(`event-name-input`)).toHaveValue(`E2E Returning Draft Event`);
		await expect(page.getByTestId(`event-description-editor`).locator(`textarea`)).toHaveValue(/E2E event description/);
		await page.goto(`/`);
		await page.goto(`/events/new`);
		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `event`, { timeout: 10000 });
		await expect(page.getByTestId(`event-name-input`)).toHaveValue(`E2E Returning Draft Event`);
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
		await clickWizardPrimary(page);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `otp`, {
			timeout: 10000,
		});
		await sendCreateFlowOtp(page, { email: anonymousIncompleteEmail, emailTestId: `event-email-input` });
		await enterOtp(page, E2E_OTP_CODE);

		await expect(page.getByTestId(`create-event-heading`)).toHaveAttribute(`data-step`, `profile`, {
			timeout: 10000,
		});
		await page.getByTestId(`profile-name-input`).fill(`Returning Host`);
		await clickWizardPrimary(page);
		await expect(page).not.toHaveURL(/\/events\/new/, { timeout: 15000 });

		const userId = getE2EUserIdForEmail(anonymousIncompleteEmail);
		const event = await getEventBySlug(page, await getCreatedEventSlugFromUrl(page));
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

function futureLocalDateTime() {
	const date = new Date();
	date.setDate(date.getDate() + 2);
	date.setHours(12, 0, 0, 0);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, `0`);
	const day = String(date.getDate()).padStart(2, `0`);
	const hours = String(date.getHours()).padStart(2, `0`);
	const minutes = String(date.getMinutes()).padStart(2, `0`);
	return `${year}-${month}-${day}T${hours}:${minutes}`;
}

async function getCreatedEventSlugFromUrl(page: Page) {
	await page.waitForURL((url) => Boolean(eventSlugFromUrl(url)), { timeout: 15000 });
	const slug = eventSlugFromUrl(new URL(page.url()));
	if (!slug) throw new Error(`Could not resolve created event slug from ${page.url()}`);
	return slug;
}

function eventSlugFromUrl(url: URL) {
	const fromQuery = url.searchParams.get(`eventSlug`)?.trim();
	if (fromQuery) return fromQuery;

	const pathSlug = url.pathname.replace(/^\//, ``).trim();
	if (pathSlug && pathSlug !== `events/new` && !pathSlug.startsWith(`events/`)) return pathSlug;
	return null;
}
