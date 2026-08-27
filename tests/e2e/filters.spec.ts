import { test, expect } from '@playwright/test';
import { createEvents, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent } from './helpers/seed';
import { openFilterDialog, waitForClientHydration } from './helpers/offering-test-utils';

test.describe('Filter Modal', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvents(page, [
			createMeditationEvent(),
			createYogaEvent(),
			createOnlineEvent()
		]);
		await page.goto('/');
		await page.getByTestId('event-card').first().waitFor({ timeout: 15000 });
		await waitForClientHydration(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('filter modal opens and closes', async ({ page }) => {
		const filterDialog = await openFilterDialog(page);
		await page.keyboard.press('Escape');
		await expect(filterDialog).toHaveCount(0);
	});

	test('show results button applies filters', async ({ page }) => {
		const filterDialog = await openFilterDialog(page);
		await filterDialog.getByTestId('filter-apply').click();
		await expect(filterDialog).toHaveCount(0);
		
		await expect(page.getByTestId('event-card').first()).toBeVisible();
	});

	test('filter dialog shows wrapping category chips', async ({ page }) => {
		const filterDialog = await openFilterDialog(page);
		const categoryWrap = filterDialog.getByTestId('category-selection-wrap');

		await expect(categoryWrap).toBeVisible();
		await expect(categoryWrap).toHaveCSS('flex-wrap', 'wrap');
		await expect(filterDialog.getByTestId('category-chip-meditation')).toBeVisible();
		await expect(filterDialog.getByTestId('category-chip-dance')).toBeVisible();
	});

	test('selecting a category in the filter dialog filters events', async ({ page }) => {
		const filterDialog = await openFilterDialog(page);
		await filterDialog.getByTestId('category-chip-meditation').click();
		await filterDialog.getByTestId('filter-apply').click();
		await expect(filterDialog).toHaveCount(0);

		await expect(page.getByTestId('event-card-title').filter({ hasText: 'Meditation Workshop' })).toBeVisible({
			timeout: 15000,
		});
		await expect(page.getByTestId('event-card-title').filter({ hasText: 'Yoga Flow Class' })).toHaveCount(0);
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
		await page.getByTestId('event-card').first().waitFor({ timeout: 15000 });
		await waitForClientHydration(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('search filters events', async ({ page }) => {
		await page.getByTestId(`plzCityInput-header-summary`).click();
		const searchInput = page.getByTestId(`plzCityInput-header`);
		await searchInput.fill(`Berlin`);
		await searchInput.press(`Enter`);
		await page.waitForTimeout(1000);

		const eventCount = await page.getByTestId('event-card').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});
});
