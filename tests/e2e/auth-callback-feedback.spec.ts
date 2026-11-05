import { expect, test } from "./helpers/fixtures";
import { waitForClientHydration } from "./helpers/offering-test-utils";

test.describe(`Auth callback feedback`, () => {
	test(`offers a Google retry when the Google PKCE verifier is missing`, async ({ page }) => {
		await page.goto(`/auth/callback?code=unknown&method=google&next=%2F`);
		await waitForClientHydration(page);

		await expect(page.getByText(`Google-Anmeldung hat nicht geklappt`)).toBeVisible();
		await expect(page.getByText(`Login-Link stammt aus anderem Browser`)).toHaveCount(0);
		await expect.poll(() => new URL(page.url()).searchParams.has(`auth_method`)).toBe(false);

		const authorizeRequest = page.waitForRequest(`**/auth/v1/authorize**`);
		await page.route(`**/auth/v1/authorize**`, (route) => route.fulfill({ status: 204 }));
		await page.getByRole(`button`, { name: `Erneut versuchen` }).click();

		const authorizeUrl = new URL((await authorizeRequest).url());
		expect(authorizeUrl.searchParams.get(`provider`)).toBe(`google`);
		const redirectTo = new URL(authorizeUrl.searchParams.get(`redirect_to`) ?? ``);
		expect(redirectTo.searchParams.get(`method`)).toBe(`google`);
	});

	test(`keeps the magic link text when the email PKCE verifier is missing`, async ({ page }) => {
		await page.goto(`/auth/callback?code=unknown&next=%2F`);
		await waitForClientHydration(page);

		await expect(page.getByText(`Login-Link stammt aus anderem Browser`)).toBeVisible();
		await expect(page.getByRole(`button`, { name: `Erneut versuchen` })).toHaveCount(0);
	});
});
