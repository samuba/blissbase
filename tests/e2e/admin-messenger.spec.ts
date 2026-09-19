import { expect, test } from './helpers/fixtures';
import { signInAsE2EAdmin } from './helpers/auth';
import { waitForClientHydration } from './helpers/offering-test-utils';
import { createTelegramScrapingTarget, createWhatsappScrapingTarget } from './helpers/seed';

test.describe(`Admin messenger pages`, () => {
	test(`WhatsApp and Telegram admin tables load without an effect-depth loop`, async ({ page }) => {
		const pageErrors: string[] = [];
		page.on(`pageerror`, (error) => pageErrors.push(error.message));
		page.on(`console`, (message) => {
			if (message.type() === `error`) pageErrors.push(message.text());
		});

		await signInAsE2EAdmin(page);
		await createWhatsappScrapingTarget(page, {
			chatJid: `120363e2e-whatsapp@g.us`,
			name: `E2E WhatsApp Group`,
		});
		await createTelegramScrapingTarget(page, {
			roomId: `@e2e-telegram`,
			name: `E2E Telegram Channel`,
		});

		await page.goto(`/admin/whatsapp`);
		await waitForClientHydration(page);
		await expect(page.getByTestId(`admin-whatsapp-page`)).toBeVisible();
		await expect(page.getByTestId(`admin-whatsapp-targets-table`)).toBeVisible();
		await expect(page.getByText(`E2E WhatsApp Group`)).toBeVisible();

		await page.goto(`/admin/telegram`);
		await waitForClientHydration(page);
		await expect(page.getByTestId(`admin-telegram-page`)).toBeVisible();
		await expect(page.getByTestId(`admin-telegram-targets-table`)).toBeVisible();
		await expect(page.getByText(`E2E Telegram Channel`)).toBeVisible();

		expect(pageErrors.join(`\n`)).not.toMatch(/effect_update_depth_exceeded/);
	});
});
