import { expect, test } from "./helpers/fixtures";
import { signInAsE2EUser } from "./helpers/auth";
import { clearTestProfiles, createCompleteProfile, createProfile, E2E_DEFAULT_USER_ID, getProfileById } from "./helpers/seed";
import { setGermanLocale, waitForClientHydration } from "./helpers/offering-test-utils";

test.describe("Public profile social links", () => {
	test.beforeEach(async ({ page }) => {
		await setGermanLocale(page);
		await signInAsE2EUser(page);
		await clearTestProfiles(page, [E2E_DEFAULT_USER_ID]);
	});

	test.afterEach(async ({ page }) => {
		await clearTestProfiles(page, [E2E_DEFAULT_USER_ID]);
	});

	test("removing a link that is not the last one saves without a form error", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				socialLinks: [
					{ type: `instagram`, value: `e2e_user` },
					{ type: `website`, value: `https://example.com` },
				],
			}),
		);
		const pageErrors: string[] = [];
		page.on(`pageerror`, (error) => pageErrors.push(error.message));

		await page.goto(`/profile/public`);
		await waitForClientHydration(page);

		await page.getByTestId(`remove-social-link`).first().click();
		await expect(page.getByTestId(`social-link-row`)).toHaveCount(1);
		await page.getByRole(`button`, { name: `Speichern` }).click();

		await expect
			.poll(async () => (await getProfileById(page, E2E_DEFAULT_USER_ID))?.socialLinks)
			.toEqual([{ type: `website`, value: `https://example.com` }]);
		expect(pageErrors).toEqual([]);
	});

	test("shows a link issue next to its own row when an earlier link is empty", async ({ page }) => {
		await createProfile(
			page,
			createCompleteProfile({
				socialLinks: [
					{ type: `instagram`, value: `` },
					{ type: `whatsapp`, value: `not-a-number` },
				],
			}),
		);

		await page.goto(`/profile/public`);
		await waitForClientHydration(page);
		await page.getByRole(`button`, { name: `Speichern` }).click();

		const rows = page.getByTestId(`social-link-row`);
		await expect(rows.nth(1).getByText(`WhatsApp number is invalid`)).toBeVisible();
		await expect(rows.nth(0).getByText(`WhatsApp number is invalid`)).toHaveCount(0);
	});
});
