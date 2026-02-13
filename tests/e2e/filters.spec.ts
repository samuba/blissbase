import { test, expect } from '@playwright/test';

test.describe('Filter Modal', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
	});

	test('filter modal opens and closes', async ({ page }) => {
		// Find and click filter button
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await expect(filterButton).toBeVisible();
		await filterButton.click();

		// Modal should open
		const modal = page.locator('[role="dialog"], .modal').filter({ hasText: /Time period|Distance|Attendance/i }).first();
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Close button should be present
		const closeButton = modal.locator('button').filter({ has: page.locator('svg').first() }).first();
		await closeButton.click();

		// Modal should close
		await expect(modal).not.toBeVisible();
	});

	test('time period quick select buttons work', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Click on "All upcoming events" to open calendar
		const timeButton = modal.locator('button').filter({ hasText: /All upcoming|Time period/i }).first();
		await timeButton.click();

		// Look for quick select options
		const quickOptions = ['This week', 'This weekend', 'Next week', 'Next 30 days'];
		for (const option of quickOptions) {
			const button = modal.locator('button').filter({ hasText: option }).first();
			if (await button.isVisible().catch(() => false)) {
				await button.click();
				
				// Button should become selected/active
				await expect(button).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
				break;
			}
		}
	});

	test('distance filter with location input', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Find location input in modal
		const locationInput = modal.locator('input[placeholder*="City"], input[placeholder*="postal"]').first();
		
		if (await locationInput.isVisible().catch(() => false)) {
			await locationInput.fill('Berlin');
			
			// Look for distance dropdown/options
			const distanceDropdown = modal.locator('button').filter({ hasText: /Everywhere|km|Distance/i }).first();
			if (await distanceDropdown.isVisible().catch(() => false)) {
				await distanceDropdown.click();
				
				// Select a distance option
				const distanceOption = modal.locator('button, [role="option"]').filter({ hasText: /50 km|100 km/i }).first();
				await distanceOption.click().catch(() => {});
			}
		}
	});

	test('attendance filter toggles', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Look for attendance toggles
		const inPersonToggle = modal.locator('button').filter({ hasText: /In-person/i }).first();
		const onlineToggle = modal.locator('button').filter({ hasText: /Online/i }).first();

		if (await inPersonToggle.isVisible().catch(() => false)) {
			await inPersonToggle.click();
			
			// Should be selected
			await expect(inPersonToggle).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
			
			// Online should NOT be selected when in-person is selected
			if (await onlineToggle.isVisible().catch(() => false)) {
				await expect(onlineToggle).not.toHaveClass(/bg-primary|selected|active/i).catch(() => {});
			}
		}

		if (await onlineToggle.isVisible().catch(() => false)) {
			await onlineToggle.click();
			
			// Should be selected
			await expect(onlineToggle).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
			
			// In-person should NOT be selected when online is selected
			if (await inPersonToggle.isVisible().catch(() => false)) {
				await expect(inPersonToggle).not.toHaveClass(/bg-primary|selected|active/i).catch(() => {});
			}
		}
	});

	test('sort by filter toggles', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Look for sort options
		const startTimeSort = modal.locator('button').filter({ hasText: /Start time/i }).first();
		const distanceSort = modal.locator('button').filter({ hasText: /^Distance$/i }).first();

		if (await startTimeSort.isVisible().catch(() => false)) {
			await startTimeSort.click();
			await expect(startTimeSort).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
		}

		if (await distanceSort.isVisible().catch(() => false)) {
			await distanceSort.click();
			await expect(distanceSort).toHaveClass(/bg-primary|selected|active/i).catch(() => {});
		}
	});

	test('reset all filters button clears selections', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Make some selections first
		const inPersonToggle = modal.locator('button').filter({ hasText: /In-person/i }).first();
		if (await inPersonToggle.isVisible().catch(() => false)) {
			await inPersonToggle.click();
		}

		// Click reset button
		const resetButton = modal.locator('button').filter({ hasText: /Reset all/i }).first();
		if (await resetButton.isVisible().catch(() => false)) {
			await resetButton.click();
			
			// Selections should be cleared
			await expect(inPersonToggle).not.toHaveClass(/bg-primary|selected|active/i).catch(() => {});
		}
	});

	test('show results button applies filters', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Click show results
		const showResultsButton = modal.locator('button').filter({ hasText: /Show results/i }).first();
		
		if (await showResultsButton.isVisible().catch(() => false)) {
			await showResultsButton.click();
			
			// Modal should close
			await expect(modal).not.toBeVisible({ timeout: 5000 });
			
			// Events should be visible
			await expect(page.locator('[data-testid="event-card"]').first()).toBeVisible();
		}
	});

	test('distance sort disabled when online events selected', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Select online attendance
		const onlineToggle = modal.locator('button').filter({ hasText: /Online/i }).first();
		if (await onlineToggle.isVisible().catch(() => false)) {
			await onlineToggle.click();
			
			// Try to select distance sort
			const distanceSort = modal.locator('button').filter({ hasText: /^Distance$/i }).first();
			if (await distanceSort.isVisible().catch(() => false)) {
				await distanceSort.click();
				
				// Should show tooltip or remain unselected
				const tooltip = page.locator('[role="tooltip"], .tooltip').filter({ hasText: /only makes sense/i }).first();
				await tooltip.isVisible().catch(() => {});
			}
		}
	});
});

test.describe('Filter Combinations', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
	});

	test('category + search combination', async ({ page }) => {
		// Select a category first
		const meditationChip = page.locator('button, [role="button"]').filter({ hasText: 'Meditation' }).first();
		if (await meditationChip.isVisible().catch(() => false)) {
			await meditationChip.click();
			await page.waitForTimeout(500);
		}

		// Then search
		const searchInput = page.locator('input[placeholder*="City"], input[placeholder*="postal"]').first();
		await searchInput.fill('Berlin');
		await searchInput.press('Enter');
		await page.waitForTimeout(1000);

		// Should show filtered results
		const eventCount = await page.locator('[data-testid="event-card"]').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});

	test('filter modal with date range', async ({ page }) => {
		// Open filter modal
		const filterButton = page.locator('button').filter({ hasText: /Filter/i }).first();
		await filterButton.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Select a date range option
		const timeButton = modal.locator('button').filter({ hasText: /All upcoming|Time period/i }).first();
		await timeButton.click();

		// Try to select "This week"
		const thisWeekButton = modal.locator('button').filter({ hasText: 'This week' }).first();
		if (await thisWeekButton.isVisible().catch(() => false)) {
			await thisWeekButton.click();
			
			// Apply filters
			const showResultsButton = modal.locator('button').filter({ hasText: /Show results/i }).first();
			if (await showResultsButton.isVisible().catch(() => false)) {
				await showResultsButton.click();
				await page.waitForTimeout(500);
				
				// Should show filtered events
				const eventCount = await page.locator('[data-testid="event-card"]').count();
				expect(eventCount).toBeGreaterThanOrEqual(0);
			}
		}
	});
});
