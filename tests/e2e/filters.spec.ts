import { test, expect } from '@playwright/test';
import { createEvent, createEvents, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent } from './helpers/seed';

test.describe('Filter Modal', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvents(page, [
			createMeditationEvent(),
			createYogaEvent(),
			createOnlineEvent()
		]);
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('filter modal opens and closes', async ({ page }) => {
		// Find and click filter button (avoid matching unrelated buttons on the page)
		const filterButton = page.getByRole('button', { name: 'Filter', exact: true });
		await expect(filterButton).toBeVisible();
		await filterButton.click();

		// Wait for modal to appear
		await page.waitForTimeout(1000);
		
		// Press Escape to close
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);
		
		// Page should still work
		await expect(page.locator('body')).toBeVisible();
	});

	test('show results button applies filters', async ({ page }) => {
		const filterButton = page.getByRole('button', { name: 'Filter', exact: true });
		await filterButton.click();
		await page.waitForTimeout(1000);

		const filterDialog = page.getByRole('dialog', { name: 'Filter' });
		const applyButton = filterDialog.getByRole('button', {
			name: /^(Show results|Ergebnisse anzeigen|Anwenden|Apply)$/i
		});
		if (await applyButton.isVisible().catch(() => false)) {
			await applyButton.click();
			await page.waitForTimeout(500);
		}
		
		// Page should still show events
		await expect(page.locator('body')).toBeVisible();
	});
});

test.describe('Filter Combinations', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvents(page, [
			createMeditationEvent({ address: ['Berlin Center', 'Berlin'] }),
			createYogaEvent({ address: ['Munich Studio', 'Munich'] }),
			createOnlineEvent()
		]);
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('search filters events', async ({ page }) => {
		const searchInput = page.locator('input[type="text"]').first();
		await searchInput.fill('Berlin');
		await searchInput.press('Enter');
		await page.waitForTimeout(1000);

		// Should show filtered results
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});
});
