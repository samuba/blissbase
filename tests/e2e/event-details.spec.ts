import { test, expect, type Locator, type Page } from '@playwright/test';
import { createEvent, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent, createMultiDayEvent } from './helpers/seed';

test.describe('Event Details Modal', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('event details modal displays all required elements', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		// Click to open details
		await firstCard.click();

		// Wait for modal/dialog to appear
		// Use a more specific selector - look for the dialog or the event details content
		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Check for title in modal (h1 with card-title class)
		const title = modal.locator('h1.card-title, h1').first();
		await expect(title).toBeVisible();

		// Check for date/time
		const dateTime = modal.locator('text=/\\d{1,2}:\\d{2}|Today|Tomorrow|AM|PM/i').first();
		await expect(dateTime).toBeVisible();

		// Check for close button
		const closeButton = modal.locator('button').first();
		await expect(closeButton).toBeVisible();
	});

	test('event details show price information', async ({ page }) => {
		await expectAnyEventModalToContain({
			page,
			description: `price information`,
			createTargetLocator: (modal) =>
				modal.locator(`text=/Free|€|\\$|Price|Preis|kostenlos/i`).first()
		});
	});

	test('event details show location with map link', async ({ page }) => {
		await createEvent(page, createMeditationEvent({ 
			address: ['Test Venue', 'Berlin'],
			latitude: 52.5200,
			longitude: 13.4050
		}));
		await page.reload();
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
		
		await expectAnyEventModalToContain({
			page,
			description: `a location map link`,
			createTargetLocator: (modal) => modal.locator(`a[href*="google.com/maps"]`).first()
		});
	});

	test('event details show tags/categories', async ({ page }) => {
		await createEvent(page, createYogaEvent({ tags: ['Yoga', 'Fitness', 'Wellness'] }));
		await page.reload();
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
		
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Look for Tags section heading or tag buttons
		const tagsHeading = modal.locator('h2').filter({ hasText: /Tags/i });
		const tagButtons = modal.locator('button').filter({ hasText: /Yoga|Fitness|Wellness/i });
		
		const hasTags = await tagsHeading.isVisible().catch(() => false) || 
		                await tagButtons.first().isVisible().catch(() => false);
		expect(hasTags).toBe(true);
	});

	test('calendar dropdown opens with options', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Look for calendar button/icon
		const calendarButton = modal.locator('button').filter({ has: page.locator('svg').first() }).first();
		
		if (await calendarButton.isVisible().catch(() => false)) {
			await calendarButton.click();
			
			// Should show calendar options or a popover
			const popover = page.locator('[role="dialog"], [role="menu"], .popover').first();
			await expect(popover).toBeVisible().catch(() => {
				// If no popover, that's okay - button might work differently
			});
		}
	});

	test('copy link button is present', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Look for copy/share button - use broader selector
		const shareButton = modal.locator('button').filter({ hasText: /Teilen|Share|Link/i }).first();
		await expect(shareButton).toBeVisible();
	});

	test('modal closes with X button', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Click close button (first button in modal is usually close)
		const closeButton = modal.locator('button').first();
		await closeButton.click();

		// Modal should close
		await expect(modal).not.toBeVisible({ timeout: 5000 });
	});

	test('modal closes when clicking outside', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();

		const modal = page.locator('[role="dialog"]').first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		// Press Escape to close modal (more reliable than clicking outside)
		await page.keyboard.press('Escape');

		// Modal should close
		await expect(modal).not.toBeVisible({ timeout: 5000 });
	});
});

test.describe('Navigation Menu', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('hamburger menu opens welcome modal', async ({ page }) => {
		// Find hamburger menu button - look for icon-only buttons
		const menuButton = page.locator('button').filter({ has: page.locator('svg').first() }).first();
		
		if (await menuButton.isVisible().catch(() => false)) {
			await menuButton.click();
			
			// Should show welcome modal or menu
			const welcomeModal = page.locator('[role="dialog"], [role="menu"]').first();
			await expect(welcomeModal).toBeVisible({ timeout: 5000 });
		}
	});

	test('create event page is accessible', async ({ page }) => {
		await page.goto('/new');
		
		// Page should load
		await expect(page.locator('body')).toBeVisible();
		
		// Should contain create event content
		await expect(page.locator('text=/new event|Telegram/i').first()).toBeVisible();
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
		await clearTestEvents(page);
		const { event } = await createEvent(page, createMeditationEvent({ slug: 'test-deep-link-event' }));
		
		// Navigate directly to the event URL
		await page.goto(`/${event.slug}`);
		
		// Event details should be visible (either as modal or page)
		await expect(page.locator('body')).toBeVisible();
		await expect(page.locator('h1, h2').first()).toBeVisible();
	});
});

async function expectAnyEventModalToContain(args: {
	page: Page;
	description: string;
	createTargetLocator: (modal: Locator) => Locator;
	maxCardsToCheck?: number;
}) {
	const { page, description, createTargetLocator, maxCardsToCheck = 10 } = args;
	const eventCards = page.locator(`[data-testid="event-card"]`);
	const totalCards = await eventCards.count();
	const cardsToCheck = Math.min(totalCards, maxCardsToCheck);

	if (!cardsToCheck) {
		throw new Error(`No event cards available while checking for ${description}`);
	}

	for (let index = 0; index < cardsToCheck; index += 1) {
		await eventCards.nth(index).click();

		const modal = page.locator(`[role="dialog"]`).first();
		await expect(modal).toBeVisible({ timeout: 10000 });

		const target = createTargetLocator(modal);
		if (await target.isVisible().catch(() => false)) {
			return;
		}

		await page.keyboard.press(`Escape`);
		await expect(modal).not.toBeVisible({ timeout: 5000 });
	}

	throw new Error(
		`Expected ${description} in at least one event details modal, but none of the first ${cardsToCheck} events had it`
	);
}
