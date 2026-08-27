import { expect, test } from '@playwright/test';

test.describe(`Legal pages`, () => {
	test(`privacy policy describes Google Sign-In and is linked from the footer`, async ({ page }) => {
		await page.goto(`/about`);
		const privacyLink = page.getByTestId(`footer-privacy-policy`);
		await expect(privacyLink).toBeVisible();
		await privacyLink.click();
		await expect(page).toHaveURL(/privacy-policy/);

		const doc = page.getByTestId(`privacy-policy`);
		await expect(doc).toBeVisible();
		await expect(page.getByRole(`heading`, { level: 1 })).toContainText(/Privacy Policy|Datenschutzerklärung/);
		await expect(doc).toContainText(`Blissbase`);
		await expect(doc).toContainText(`Google`);
		await expect(doc).toContainText(`hi@blissbase.app`);
		await expect(doc).toContainText(/Limited Use|Limited-Use|Google API Services User Data Policy/);
	});

	test(`terms of service describe the product and Google Sign-In`, async ({ page }) => {
		await page.goto(`/about`);
		const termsLink = page.getByTestId(`footer-terms-of-service`);
		await expect(termsLink).toBeVisible();
		await termsLink.click();
		await expect(page).toHaveURL(/terms-of-service/);

		const doc = page.getByTestId(`terms-of-service`);
		await expect(doc).toBeVisible();
		await expect(page.getByRole(`heading`, { level: 1 })).toContainText(
			/General Terms and Conditions|Nutzungsbedingungen|Terms of Service|AGB/,
		);
		await expect(doc).toContainText(`Blissbase`);
		await expect(doc).toContainText(`Google Sign-In`);
		await expect(doc).toContainText(`hi@blissbase.app`);
	});
});
