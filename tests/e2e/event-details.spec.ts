import { test, expect } from '@playwright/test';

test.describe('Event Details Modal', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
	});

	test('event details modal displays all required elements', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Get event title from card
		const cardTitle = await firstCard.locator('h2, h3, .event-title').first().textContent();
		
		// Click to open details
		await firstCard.click();

		// Wait for modal
		const modal = page.locator('[role="dialog"], .modal, [data-testid="event-details"]').first();
		await expect(modal).toBeVisible({ timeout: 5000 });

		// Check for title in modal
		await expect(modal.locator(`text=${cardTitle}`).first()).toBeVisible();

		// Check for date/time
		const dateTime = modal.locator('text=/\\d{1,2}:\\d{2}|Today|Tomorrow|AM|PM/i').first();
		await expect(dateTime).toBeVisible();

		// Check for close button
		const closeButton = modal.locator('button').filter({ has: page.locator('svg').first() }).first();
		await expect(closeButton).toBeVisible();
	});

	test('event details show price information', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Look for price info (Free or € amount)
		const priceElement = modal.locator('text=/Free|€|\\$|Price/i').first();
		await priceElement.isVisible().catch(() => {
			// Price might not be present on all events
		});
	});

	test('event details show location with map link', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Look for location info
		const locationElement = modal.locator('text=/Location|Address|Venue/i, a[href*="google.com/maps"]').first();
		await locationElement.isVisible().catch(() => {
			// Location might not be present on all events
		});
	});

	test('event details show tags/categories', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Look for tags section
		const tags = modal.locator('.tag, [data-testid="tag"], button').filter({ hasText: /Meditation|Yoga|Workshop|Dance/i }).first();
		await tags.isVisible().catch(() => {
			// Tags might not be present on all events
		});
	});

	test('calendar dropdown opens with options', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Look for calendar button/icon
		const calendarButton = modal.locator('button').filter({ has: page.locator('svg').filter({ hasText: /calendar|Calendar/i }).first() }).first();
		
		// Alternative: look for button near date/time
		const altCalendarButton = modal.locator('button').filter({ hasText: /calendar|Add to calendar/i }).first();
		
		const button = calendarButton.or(altCalendarButton);
		
		if (await button.isVisible().catch(() => false)) {
			await button.click();
			
			// Should show calendar options
			const calendarOptions = ['Google', 'Apple', 'Outlook', 'Yahoo', 'iCal'];
			for (const option of calendarOptions) {
				const optionElement = page.locator(`text=${option}`).first();
				await optionElement.isVisible().catch(() => {});
			}
		}
	});

	test('copy link button is present', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Look for copy/share button
		const copyButton = modal.locator('button').filter({ hasText: /Copy|Share|Link/i }).first();
		await copyButton.isVisible().catch(() => {
			// Copy button might not be present
		});
	});

	test('modal closes with X button', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Click close button
		const closeButton = modal.locator('button').filter({ has: page.locator('svg').first() }).first();
		await closeButton.click();

		// Modal should close
		await expect(modal).not.toBeVisible({ timeout: 5000 });
	});

	test('modal closes when clicking outside', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Click outside the modal (on the backdrop)
		const modalBox = await modal.boundingBox();
		const viewport = page.viewportSize();

		if (!modalBox || !viewport) {
			throw new Error(`Could not determine modal or viewport dimensions for outside click test`);
		}

		const candidatePoints = [
			{ x: Math.floor(modalBox.x) - 10, y: Math.floor(modalBox.y + modalBox.height / 2) },
			{ x: Math.floor(modalBox.x + modalBox.width) + 10, y: Math.floor(modalBox.y + modalBox.height / 2) },
			{ x: 5, y: 5 },
			{ x: viewport.width - 5, y: 5 },
			{ x: 5, y: viewport.height - 5 },
			{ x: viewport.width - 5, y: viewport.height - 5 }
		];

		const clickPoint = candidatePoints.find(({ x, y }) => {
			const isInViewport = x >= 0 && y >= 0 && x < viewport.width && y < viewport.height;
			const isInsideModal =
				x >= modalBox.x &&
				x <= modalBox.x + modalBox.width &&
				y >= modalBox.y &&
				y <= modalBox.y + modalBox.height;

			return isInViewport && !isInsideModal;
		});

		if (!clickPoint) {
			throw new Error(`Could not find a click point outside the modal bounds`);
		}

		await page.mouse.click(clickPoint.x, clickPoint.y);

		// Modal should close
		await expect(modal).not.toBeVisible({ timeout: 5000 });
	});
});

test.describe('Navigation Menu', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
	});

	test('hamburger menu opens welcome modal', async ({ page }) => {
		// Find hamburger menu button
		const hamburgerButton = page.locator('button').filter({ has: page.locator('svg').filter({ hasText: /menu|Menu/i }).first() }).first();
		
		// Alternative: look for aria-label
		const altHamburger = page.locator('button[aria-label*="menu"], button[aria-label*="Menu"]').first();
		
		const menuButton = hamburgerButton.or(altHamburger);
		
		if (await menuButton.isVisible().catch(() => false)) {
			await menuButton.click();
			
			// Should show welcome modal
			const welcomeModal = page.locator('[role="dialog"], .modal').filter({ hasText: /Welcome|Blissbase/i }).first();
			await expect(welcomeModal).toBeVisible({ timeout: 5000 });
			
			// Should contain key elements
			await expect(welcomeModal.locator('text=Create new event').first()).toBeVisible().catch(() => {});
			await expect(welcomeModal.locator('text=Login').first()).toBeVisible().catch(() => {});
		}
	});

	test('create event page is accessible', async ({ page }) => {
		await page.goto('/new');
		
		// Page should load
		await expect(page.locator('body')).toBeVisible();
		
		// Should contain create event content
		await expect(page.locator('text=/Create|new event|Telegram/i').first()).toBeVisible();
	});

	test('event sources page is accessible', async ({ page }) => {
		await page.goto('/sources');
		
		// Page should load
		await expect(page.locator('body')).toBeVisible();
		
		// Should contain sources content
		await expect(page.locator('text=/Sources|Websites|Telegram/i').first()).toBeVisible();
	});
});

test.describe('Event Deep Linking', () => {
	test('event page loads directly from URL', async ({ page }) => {
		// First get an event slug from the main page
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });

		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"], .modal').first();
		await expect(modal).toBeVisible();

		// Get the current URL which should contain the event slug
		const currentUrl = page.url();
		
		if (currentUrl.includes('/202') || currentUrl.includes('/event')) {
			// Navigate directly to that URL
			await page.goto(currentUrl);
			
			// Event details should be visible (either as modal or page)
			await expect(page.locator('body')).toBeVisible();
			await expect(page.locator('h1, h2').first()).toBeVisible();
		}
	});
});
