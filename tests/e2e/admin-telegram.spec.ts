import type { Page } from "@playwright/test";
import * as devalue from "devalue";
import { expect, test } from "./helpers/fixtures";
import { signInAsE2EUser } from "./helpers/auth";
import { waitForClientHydration } from "./helpers/offering-test-utils";

const adminEmail = `test@admin.de`;
const target = { roomId: `-1001111111111`, name: `Existing Target` };
const availableDialog = {
	roomId: `-1002222222222`,
	name: `New Group`,
	kind: `group`,
	username: null,
	accountId: `primary`,
	lastMessageTime: null,
};

test.describe(`Admin Telegram targets`, () => {
	test.beforeEach(async ({ page }) => {
		await signInAsE2EUser(page, { email: adminEmail });
		const response = await page.request.post(`/api/test/seed`, {
			data: { action: `createTelegramScrapingTarget`, data: target },
		});
		expect(response.ok()).toBe(true);
		await stubAvailableTelegramDialogs(page);
	});

	test(`opening a target right after closing the add form keeps both forms working`, async ({ page }) => {
		const pageErrors: string[] = [];
		page.on(`pageerror`, (error) => pageErrors.push(error.message));

		await page.goto(`/admin/telegram`);
		await waitForClientHydration(page);

		await page.getByTestId(`telegram-add-target-button`).click();
		const addDialog = page.getByTestId(`telegram-add-dialog`);
		await addDialog.getByTestId(`telegram-dialog-option`).click();
		await expect(addDialog.locator(`form`)).toBeVisible();

		// Click the row while the add dialog still plays its close animation.
		await page.evaluate(async () => {
			const close = document.querySelector(`[data-testid="telegram-add-dialog"] button[aria-label="Schließen"]`);
			const row = document.querySelector(`[data-testid="telegram-target-row"]`);
			if (!(close instanceof HTMLElement) || !(row instanceof HTMLElement)) {
				throw new Error(`missing add-dialog close button or target row`);
			}
			close.click();
			await new Promise((resolve) => setTimeout(resolve, 30));
			if (!document.querySelector(`[data-testid="telegram-add-dialog"] form`)) {
				throw new Error(`add form unmounted before the close animation finished`);
			}
			row.click();
		});

		const editDialog = page.getByTestId(`telegram-edit-dialog`);
		await expect(editDialog.locator(`input[name="roomId"]`)).toHaveValue(target.roomId);
		expect(pageErrors).toEqual([]);

		await editDialog.getByRole(`button`, { name: `Schließen` }).click();
		await expect(editDialog).toBeHidden();
	});
});

/**
 * The real query lists dialogs via Telegram, so answer the client's remote call directly
 * in the SvelteKit remote response format.
 */
async function stubAvailableTelegramDialogs(page: Page) {
	await page.route(`**/_app/remote/*/getAvailableTelegramDialogs*`, async (route) => {
		const id = new URL(route.request().url()).pathname.split(`/_app/remote/`)[1];
		const payload = {
			accounts: [`primary`],
			accountStatuses: [{ accountId: `primary`, listed: 1, error: null, available: 1 }],
			dialogs: [availableDialog],
		};
		await route.fulfill({
			json: { type: `result`, data: devalue.stringify({ q: { [`${id}/`]: { v: payload } } }) },
		});
	});
}
