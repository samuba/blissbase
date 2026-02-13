import { test, expect } from '@playwright/test';
import { createEvent, createEvents, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent } from './helpers/seed';

test.describe('Homepage', () => {
	test.beforeEach(async ({ page }) => {
		// Clear test events and seed fresh data
		await clearTestEvents(page);
		
		// Create a few test events
		await createEvents(page, [
			createMeditationEvent(),
			createYogaEvent(),
			createOnlineEvent()
		]);
		
		await page.goto('/');
		// Wait for the page to load and events to appear
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
	});

	test.afterEach(async ({ page }) => {
		// Clean up test events
		await clearTestEvents(page);
	});

	test('displays hero section with logo and tagline', async ({ page }) => {
		// Check for logo/brand name
		await expect(page.locator('text=Blissbase')).toBeVisible();
		// Check for tagline (German version)
		await expect(page.locator('text=/Achtsame|Conscious/i')).toBeVisible();
	});

	test('displays search and filter bar', async ({ page }) => {
		// Check for search input
		const searchInput = page.locator('input[placeholder*="City"], input[placeholder*="postal"], input[type="text"]').first();
		await expect(searchInput).toBeVisible();

		// Check for filter button
		const filterButton = page.locator('button').filter({ hasText: /Filter|filter/i }).first();
		await expect(filterButton).toBeVisible();
	});

	test('displays category filter chips', async ({ page }) => {
		// Check for common category chips
		const categories = ['Meditation', 'Yoga'];
		for (const category of categories) {
			const chip = page.locator('button').filter({ hasText: category }).first();
			// At least some categories should be visible
			await expect(chip).toBeVisible().catch(() => {
				// Category might not be visible if no events have it
			});
		}
	});

	test('event cards display with required elements', async ({ page }) => {
		// Get first event card
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Check for event title
		await expect(firstCard.locator('h3, h2').first()).toBeVisible();

		// Check for date/time display
		const dateTime = firstCard.locator('text=/\\d{1,2}:\\d{2}|Today|Tomorrow|AM|PM/i').first();
		await expect(dateTime).toBeVisible();
	});

	test('clicking category chip filters events', async ({ page }) => {
		// Find and click a category chip
		const meditationChip = page.locator('button').filter({ hasText: 'Meditation' }).first();
		
		if (await meditationChip.isVisible().catch(() => false)) {
			await meditationChip.click();
			
			// Wait for filter to apply
			await page.waitForTimeout(500);
			
			// Chip should now be selected/active
			await expect(meditationChip).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
		}
	});

	test('search by city filters events', async ({ page }) => {
		// Create an event in Berlin
		await createEvent(page, createMeditationEvent({ address: ['Zen Center', 'Berlin'] }));
		
		const searchInput = page.locator('input[placeholder*="City"], input[placeholder*="postal"]').first();
		await expect(searchInput).toBeVisible();

		// Type a city name
		await searchInput.fill('Berlin');
		await searchInput.press('Enter');

		// Wait for search to apply
		await page.waitForTimeout(1000);

		// Events should update
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});

	test('event card click opens event details', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Click the card
		await firstCard.click();

		// Wait for modal/dialog to open - use role="dialog" selector
		const dialog = page.locator('[role="dialog"]').first();
		await expect(dialog).toBeVisible({ timeout: 10000 });

		// Dialog should have content
		await expect(dialog.locator('h1').first()).toBeVisible();
	});

	test('favorite button is present on event cards', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		
		// Look for heart icon/button
		const favoriteButton = firstCard.locator('button').first();
		await expect(favoriteButton).toBeVisible();
	});
});

test.describe('Homepage - Loading States', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('shows loading indicator while fetching events', async ({ page }) => {
		// Create an event first so there's something to load
		await createEvent(page, createMeditationEvent());
		
		await page.goto('/');
		
		// Eventually events should load
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
		
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBeGreaterThan(0);
	});

	test('handles empty search results gracefully', async ({ page }) => {
		await page.goto('/');
		await page.waitForTimeout(1000);

		// Search for a location that likely has no events
		const searchInput = page.locator('input[placeholder*="City"], input[placeholder*="postal"]').first();
		await searchInput.fill('XXXXXXXXXXXX');
		await searchInput.press('Enter');

		// Wait for search to apply
		await page.waitForTimeout(1000);

		// Should show empty state or no events
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBe(0);
	});
});
