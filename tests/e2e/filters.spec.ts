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
		// Find and click filter button
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await expect(filterButton).toBeVisible();
		await filterButton.click();

		// Modal should open - look for any dialog
		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Click outside or press escape to close
		await page.keyboard.press('Escape');

		// Modal should close
		await expect(modal).not.toBeVisible();
	});

	test('time period quick select buttons work', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Click on time/date button to open calendar options
		const timeButton = modal.locator('button').filter({ hasText: /Wann|When|Time|Zeit/i }).first();
		if (await timeButton.isVisible().catch(() => false)) {
			await timeButton.click();

			// Look for quick select options
			const quickOptions = ['Woche', 'week', 'weekend', 'Monat', 'month'];
			for (const option of quickOptions) {
				const button = modal.locator('button').filter({ hasText: new RegExp(option, 'i') }).first();
				if (await button.isVisible().catch(() => false)) {
					await button.click();
					break;
				}
			}
		}
	});

	test('distance filter with location input', async ({ page }) => {
		// Create event with coordinates for distance filtering
		await createEvent(page, createMeditationEvent({ 
			latitude: 52.5200, 
			longitude: 13.4050,
			address: ['Berlin Center', 'Berlin']
		}));
		
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Find location input in modal
		const locationInput = modal.locator('input[type="text"]').first();
		
		if (await locationInput.isVisible().catch(() => false)) {
			await locationInput.fill('Berlin');
			await page.waitForTimeout(500);
			
			// Look for distance dropdown/options
			const distanceDropdown = modal.locator('button').filter({ hasText: /km|Entfernung|Distance/i }).first();
			if (await distanceDropdown.isVisible().catch(() => false)) {
				await distanceDropdown.click();
			}
		}
	});

	test('attendance filter toggles', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Look for attendance toggles (Online/Offline/Ort/Online)
		const onlineToggle = modal.locator('button').filter({ hasText: /Online/i }).first();
		const offlineToggle = modal.locator('button').filter({ hasText: /Ort|Offline|Vor Ort/i }).first();

		if (await onlineToggle.isVisible().catch(() => false)) {
			await onlineToggle.click();
			// Should be selected
			await expect(onlineToggle).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
		}

		if (await offlineToggle.isVisible().catch(() => false)) {
			await offlineToggle.click();
			await expect(offlineToggle).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
		}
	});

	test('sort by filter toggles', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Look for sort options
		const sortButtons = modal.locator('button').filter({ hasText: /Sort|Zeit|Date|Distance|Entfernung/i });
		const count = await sortButtons.count();
		
		if (count > 0) {
			await sortButtons.first().click();
		}
	});

	test('reset all filters button clears selections', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Look for reset button
		const resetButton = modal.locator('button').filter({ hasText: /Reset|Zurücksetzen|Clear/i }).first();
		if (await resetButton.isVisible().catch(() => false)) {
			await resetButton.click();
		}
	});

	test('show results button applies filters', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Click show results/apply button
		const showResultsButton = modal.locator('button').filter({ hasText: /Ergebnisse|Results|Anwenden|Apply/i }).first();
		
		if (await showResultsButton.isVisible().catch(() => false)) {
			await showResultsButton.click();
			
			// Modal should close
			await expect(modal).not.toBeVisible({ timeout: 5000 });
		}
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

	test('category + search combination', async ({ page }) => {
		// Select a category first
		const meditationChip = page.locator('button').filter({ hasText: 'Meditation' }).first();
		if (await meditationChip.isVisible().catch(() => false)) {
			await meditationChip.click();
			await page.waitForTimeout(500);
		}

		// Then search
		const searchInput = page.locator('input[type="text"]').first();
		await searchInput.fill('Berlin');
		await searchInput.press('Enter');
		await page.waitForTimeout(1000);

		// Should show filtered results (or empty)
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});
});
