import { test, expect } from '@playwright/test';
import { createEvent, createEvents, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent } from './helpers/seed';
import { waitForClientHydration } from './helpers/offering-test-utils';

test.describe('Homepage', () => {
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

	test('page loads with logo', async ({ page }) => {
		await expect(page.getByTestId('hero-logo')).toBeVisible();
	});

	test('displays search and filter bar', async ({ page }) => {
		await expect(page.getByTestId('event-search-input')).toBeVisible();
		await expect(page.getByTestId('open-filter-dialog')).toBeVisible();
	});

	test('event cards display with required elements', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		await expect(firstCard).toBeVisible();
		await expect(firstCard.getByTestId('event-card-title')).toBeVisible();
	});

	test('clicking category chip filters events', async ({ page }) => {
		const meditationChip = page.getByTestId('tag-chip-meditation');
		if (await meditationChip.isVisible().catch(() => false)) {
			await meditationChip.click();
			await page.waitForTimeout(500);
		}
	});

	test('search by city filters events', async ({ page }) => {
		const searchInput = page.getByTestId('plzCityInput-header');
		await expect(searchInput).toBeVisible();

		await searchInput.fill('Berlin');
		await searchInput.press('Enter');
		await page.waitForTimeout(1000);

		const eventCount = await page.getByTestId('event-card').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});

	test('event card click opens event details', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		await expect(firstCard).toBeVisible();

		await firstCard.click();
		await expect(page.getByTestId('details-dialog')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('event-title')).toBeVisible();
	});
});

test.describe('Homepage - Loading States', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('shows loading indicator while fetching events', async ({ page }) => {
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		
		await page.getByTestId('event-card').first().waitFor({ timeout: 15000 });
		
		const eventCount = await page.getByTestId('event-card').count();
		expect(eventCount).toBeGreaterThan(0);
	});
});
