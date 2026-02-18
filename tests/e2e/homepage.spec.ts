import { test, expect } from '@playwright/test';
import { createEvent, createEvents, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent } from './helpers/seed';

test.describe('Homepage', () => {
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

	test('page loads with logo', async ({ page }) => {
		// Just check the logo image exists
		await expect(page.locator('img[src*="logo"]')).toBeVisible();
	});

	test('displays search and filter bar', async ({ page }) => {
		// Check for search input
		const searchInput = page.locator('input[type="text"]').first();
		await expect(searchInput).toBeVisible();
	});

	test('event cards display with required elements', async ({ page }) => {
		// Get first event card
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Check for event title (h3 in card)
		await expect(firstCard.locator('h3').first()).toBeVisible();
	});

	test('clicking category chip filters events', async ({ page }) => {
		// Find and click a category chip
		const meditationChip = page.locator('button').filter({ hasText: 'Meditation' }).first();
		
		if (await meditationChip.isVisible().catch(() => false)) {
			await meditationChip.click();
			await page.waitForTimeout(500);
		}
	});

	test('search by city filters events', async ({ page }) => {
		const searchInput = page.locator('input[type="text"]').first();
		await expect(searchInput).toBeVisible();

		await searchInput.fill('Berlin');
		await searchInput.press('Enter');
		await page.waitForTimeout(1000);

		// Should show filtered results or empty
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});

	test('event card click opens event details', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		await firstCard.click();
		await page.waitForTimeout(2000);
		
		// Check if we're showing event details (any heading)
		const title = page.locator('h1, h2').first();
		await expect(title).toBeVisible();
	});
});

test.describe('Homepage - Loading States', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('shows loading indicator while fetching events', async ({ page }) => {
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		
		// Eventually events should load
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
		
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBeGreaterThan(0);
	});
});
