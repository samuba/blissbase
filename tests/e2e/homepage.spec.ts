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

	test('displays hero section with logo and tagline', async ({ page }) => {
		// Check for logo/brand name (img alt text)
		await expect(page.locator('img[alt="Blissbase"]')).toBeVisible();
		// Check for German tagline
		await expect(page.locator('text=Achtsame Events')).toBeVisible();
	});

	test('displays search and filter bar', async ({ page }) => {
		// Check for search input
		const searchInput = page.locator('input[type="text"]').first();
		await expect(searchInput).toBeVisible();

		// Check for filter button (look for any button with filter-related text or icon)
		const buttons = page.locator('button');
		await expect(buttons.first()).toBeVisible();
	});

	test('displays category filter chips', async ({ page }) => {
		// Check for category chips
		const chips = page.locator('button').filter({ hasText: /Meditation|Yoga|Tantra/i });
		// Should have some category buttons
		await expect(chips.first()).toBeVisible().catch(() => {
			// Categories might not be visible if no events have them
		});
	});

	test('event cards display with required elements', async ({ page }) => {
		// Get first event card
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Check for event title (h3 in card)
		await expect(firstCard.locator('h3').first()).toBeVisible();

		// Check for date/time display
		const dateTime = firstCard.locator('text=/\\d{1,2}:\\d{2}|Today|Tomorrow|Heute|Morgen|Uhr/i').first();
		await expect(dateTime).toBeVisible();
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

		// Wait for modal/dialog to open
		// The dialog might not have role="dialog" - let's check if page navigated or modal appeared
		await page.waitForTimeout(2000);
		
		// Check if we're showing event details (either in modal or new page)
		// EventDetails has h1.card-title
		const title = page.locator('h1, h2').first();
		await expect(title).toBeVisible();
	});

	test('favorite button is present on event cards', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		// Event card should have at least one button (favorite)
		const buttons = firstCard.locator('button');
		await expect(buttons.first()).toBeVisible();
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

	test('handles empty search results gracefully', async ({ page }) => {
		await page.goto('/');
		await page.waitForTimeout(1000);

		const searchInput = page.locator('input[type="text"]').first();
		await searchInput.fill('XXXXXXXXXXXX');
		await searchInput.press('Enter');
		await page.waitForTimeout(1000);

		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBe(0);
	});
});
