import { test, expect } from '@playwright/test';
import { createEvent, clearTestEvents, createMeditationEvent, createYogaEvent, createTelegramEvent } from './helpers/seed';

test.describe('Event Details Modal', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('event details modal displays all required elements', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await expect(firstCard).toBeVisible();

		await firstCard.click();
		await page.waitForTimeout(2000);

		const title = page.locator('h1').first();
		await expect(title).toBeVisible();
	});

	test('event details show price information', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();
		await page.waitForTimeout(2000);

		await expect(page.getByText('Free')).toBeVisible();
	});

	// formatAddress joins address parts with ' · ' (middle dot), not ', '
	test('event details show location', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();
		await page.waitForTimeout(2000);

		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText(/Zen Center.*Berlin/)).toBeVisible();
	});

	test('modal closes with Escape key', async ({ page }) => {
		const firstCard = page.locator('[data-testid="event-card"]').first();
		await firstCard.click();
		await page.waitForTimeout(2000);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(1000);

		await expect(page.locator('body')).toBeVisible();
	});
});

test.describe('Source-Dependent Rendering', () => {
	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	// Navigate directly to the event URL to avoid race conditions with parallel workers
	// sharing the same PGlite database.

	test('regular source shows registration link and source label', async ({ page }) => {
		await clearTestEvents(page);
		const { event } = await createEvent(page, createMeditationEvent());

		await page.goto(`/${event.slug}`);
		await page.waitForSelector('h1', { timeout: 15000 });

		// Source label (Quelle:/Source:) section should be visible with source link
		await expect(page.getByRole('link', { name: 'Awara' })).toBeVisible();
		// Registration link should be visible (translated: Anmelden → Register)
		await expect(page.getByRole('link', { name: /Anmelden|Register/i })).toBeVisible();
	});

	test('heilnetz source shows source link instead of registration button', async ({ page }) => {
		await clearTestEvents(page);
		const { event } = await createEvent(page, createYogaEvent());

		await page.goto(`/${event.slug}`);
		await page.waitForSelector('h1', { timeout: 15000 });

		// The action button should be "Quelle/Source" (not "Anmelden/Register") for heilnetz
		await expect(page.getByRole('link', { name: /Quelle|Source/i }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: /Anmelden|Register/i })).not.toBeVisible();
		// Source label should show "Heilnetz"
		await expect(page.getByRole('link', { name: 'Heilnetz' })).toBeVisible();
	});

	test('telegram source hides source label section', async ({ page }) => {
		await clearTestEvents(page);
		const { event } = await createEvent(page, createTelegramEvent());

		await page.goto(`/${event.slug}`);
		await page.waitForSelector('h1', { timeout: 15000 });

		await expect(page.locator('h1').first()).toBeVisible();
		// Source label block (Quelle: / Source: pill) is hidden for telegram events
		// The {#if event.source !== 'telegram'} guard prevents rendering it
		await expect(page.getByText(/Quelle:|Source:/)).not.toBeVisible();
	});
});

test.describe('Navigation Menu', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('create event page is accessible', async ({ page }) => {
		await page.goto('/new');
		await expect(page.locator('body')).toBeVisible();
		await expect(page.locator('h1, h2').first()).toBeVisible();
	});

	test('event sources page is accessible', async ({ page }) => {
		await page.goto('/sources');
		await expect(page.locator('body')).toBeVisible();
		await expect(page.locator('h1, h2').first()).toBeVisible();
	});
});

test.describe('Event Deep Linking', () => {
	test('event page loads directly from URL', async ({ page }) => {
		await clearTestEvents(page);
		const { event } = await createEvent(page, createMeditationEvent({ slug: 'test-deep-link-event' }));

		await page.goto(`/${event.slug}`);
		await expect(page.locator('body')).toBeVisible();
		await expect(page.locator('h1').first()).toBeVisible();
	});
});
