import { expect, type Page } from "@playwright/test";

export async function fillProfileBio(page: Page, text: string) {
	const bioEditor = page.getByTestId(`profile-bio-editor`).locator(`[contenteditable="true"]`);
	await bioEditor.click();
	await page.keyboard.press(`ControlOrMeta+A`);
	await page.keyboard.type(text);
	await expect(page.getByTestId(`profile-bio-editor`).locator(`textarea`)).toHaveValue(new RegExp(text));
}

export async function fillEventDescription(page: Page, text: string) {
	const editor = page.getByTestId(`event-description-editor`).locator(`[contenteditable="true"]`);
	await editor.click();
	await page.keyboard.press(`ControlOrMeta+A`);
	await page.keyboard.type(text);
	await expect(page.getByTestId(`event-description-editor`).locator(`textarea`)).toHaveValue(new RegExp(text));
}

export async function clickWizardPrimary(page: Page) {
	await page.getByTestId(`wizard-primary`).click();
}

export async function addSocialLink(page: Page, value = `https://example.com/e2e-user`) {
	await page.getByTestId(`add-social-link`).click();
	const dialog = page.getByTestId(`add-social-link-dialog`);
	await dialog.getByTestId(`add-social-link-value`).fill(value);
	await dialog.getByTestId(`add-social-link-submit`).click();
	await expect(dialog).toBeHidden();
}

export async function uploadRequiredProfileImages(page: Page) {
	for (const kind of [`profile`, `banner`]) {
		const crop = page.getByTestId(`${kind}-image-crop`);
		if (await crop.evaluate((el) => el.classList.contains(`hidden`))) continue;
		await page.getByTestId(`${kind}-image-file`).setInputFiles(`static/pwa-192-maskable.png`);
		await page.getByTestId(`${kind}-crop-done`).click();
		await expect(page.getByTestId(`${kind}-image-file`)).toBeEnabled({ timeout: 30000 });
	}
}

export async function enterOtp(page: Page, code: string) {
	const otp = page.getByTestId(`otp-input`);
	await otp.click();
	await page.keyboard.press(`ControlOrMeta+A`);
	await page.keyboard.type(code);
}
