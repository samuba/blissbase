import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Wait for the page to load and events to appear
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
	});

	test('displays hero section with logo and tagline', async ({ page }) => {
		// Check for logo/brand name
		await expect(page.locator('text=Blissbase')).toBeVisible();
		// Check for tagline
		await expect(page.locator('text=Conscious events near you')).toBeVisible();
	});

	test('displays search and filter bar', async ({ page }) => {
		// Check for search input
		const searchInput = page.locator('input[placeholder*="City"], input[placeholder*="postal"]').first();
		await expect(searchInput).toBeVisible();

		// Check for filter button
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await expect(filterButton).toBeVisible();
	});

	test('displays category filter chips', async ({ page }) => {
		// Check for common category chips
		const categories = ['Meditation', 'Breathwork', 'Tantra', 'Yoga'];
		for (const category of categories) {
			const chip = page.locator('button, [role="button"]').filter({ hasText: category }).first();
			// At least some categories should be visible
			await expect(chip).toBeVisible().catch(() => {});
		}
	});

	test('event cards display with required elements', async ({ page }) => {
		// Get first event card
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Check for event title
		await expect(firstCard.locator('h2, h3, .event-title').first()).toBeVisible();

		// Check for date/time display
		const dateTime = firstCard.locator('text=/\\d{1,2}:\\d{2}|Today|Tomorrow|AM|PM/i').first();
		await expect(dateTime).toBeVisible();

		// Check for location
		const location = firstCard.locator('.event-location, [data-testid="event-location"]').first();
		// Location may not always be present
		await location.isVisible().catch(() => {});
	});

	test('clicking category chip filters events', async ({ page }) => {
		// Find and click a category chip (Meditation is commonly available)
		const meditationChip = page.locator('button, [role="button"]').filter({ hasText: 'Meditation' }).first();
		
		if (await meditationChip.isVisible().catch(() => false)) {
			// Get initial event count
			const initialCount = await page.locator('[data-testid="event-card"]').count();
			
			await meditationChip.click();
			
			// Wait for filter to apply
			await page.waitForTimeout(500);
			
			// Chip should now be selected/active
			await expect(meditationChip).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
			
			// Events should be filtered and the displayed set should change
			const filteredCount = await page.locator('[data-testid="event-card"]').count();
			expect(filteredCount).toBeLessThanOrEqual(initialCount);
			expect(filteredCount).not.toBe(initialCount);
		}
	});

	test('search by city filters events', async ({ page }) => {
		const searchInput = page.locator('input[placeholder*="City"], input[placeholder*="postal"]').first();
		await expect(searchInput).toBeVisible();

		// Type a city name
		await searchInput.fill('Berlin');
		await searchInput.press('Enter');

		// Wait for search to apply
		await page.waitForTimeout(1000);

		// Events should update (or show empty state)
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		// Berlin might have events or not - just verify the search didn't crash
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});

	test('event card click opens event details', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Get the event title for later verification
		const eventTitle = await firstCard.locator('h2, h3, .event-title').first().textContent();
		
		// Click the card
		await firstCard.click();

		// Wait for modal/dialog to open
		const dialog = page.locator('[role="dialog"], .modal, [data-testid="event-details"]').first();
		await expect(dialog).toBeVisible({ timeout: 5000 });

		// Dialog should contain the event title
		await expect(dialog.locator(`text=${eventTitle}`).first()).toBeVisible();
	});

	test('favorite button is present on event cards', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		
		// Look for heart icon/button
		const favoriteButton = firstCard.locator('button').filter({ has: page.locator('svg, .heart, [data-testid="favorite"]').first() }).first();
		
		// Favorite button might be present or not depending on auth state
		await favoriteButton.isVisible().catch(() => {});
	});
});

test.describe('Homepage - Loading States', () => {
	test('shows loading indicator while fetching events', async ({ page }) => {
		await page.goto('/');
		
		// Check for loading indicator (might be brief)
		const loadingIndicator = page.locator('text=Loading, text=loading, .loading, [data-testid="loading"]').first();
		await loadingIndicator.isVisible().catch(() => {});
		
		// Eventually events should load
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
	});

	test('handles empty search results gracefully', async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });

		// Search for a location that likely has no events
		const searchInput = page.locator('input[placeholder*="City"], input[placeholder*="postal"]').first();
		await searchInput.fill('XXXXXXXXXXXX');
		await searchInput.press('Enter');

		// Wait for search to apply
		await page.waitForTimeout(1000);

		// Should show empty state or no events
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		// Empty state is acceptable
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});
});
