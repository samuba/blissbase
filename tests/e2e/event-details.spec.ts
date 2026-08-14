import { test, expect } from '@playwright/test';
import { signInAsE2EUser } from './helpers/auth';
import { createEvent, clearTestEvents, createMeditationEvent, createYogaEvent, createTelegramEvent } from './helpers/seed';
import { waitForClientHydration } from './helpers/offering-test-utils';

test.describe('Event Details Modal', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		await page.getByTestId('event-card').first().waitFor({ timeout: 15000 });
		await waitForClientHydration(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('event details modal displays all required elements', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		await expect(firstCard).toBeVisible();

		await firstCard.click();
		const dialog = page.getByTestId('details-dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId('event-title')).toBeVisible();
	});

	test('event details show price information', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		await firstCard.click();
		const dialog = page.getByTestId('details-dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByText('Free', { exact: true })).toBeVisible();
	});

	// formatAddress joins address parts with ' · ' (middle dot), not ', '
	test('event details show location', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		await firstCard.click();
		const dialog = page.getByTestId('details-dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByText(/Zen Center.*Berlin/)).toBeVisible();
	});

	test('dialog stays synchronized across repeated close methods', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		const dialog = page.getByTestId('details-dialog');

		await firstCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		const detailUrl = page.url();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL('/');

		await firstCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(page).toHaveURL(detailUrl);
		await dialog.getByTestId('dialog-close').click({ force: true });
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL('/');

		await firstCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(page).toHaveURL(detailUrl);
		await page.goBack();
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL('/');

		// Rapid reopen after dismiss must still be closable.
		await firstCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL('/');
		await firstCard.click();
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL('/');

		// Stress: many open/close cycles must not leave a stuck overlay after the URL resets.
		for (let i = 0; i < 8; i++) {
			await firstCard.click();
			await expect(dialog).toBeVisible({ timeout: 15000 });
			await expect(page.locator('[data-dialog-overlay]')).toHaveCount(1);
			await page.keyboard.press('Escape');
			await expect(dialog).toHaveCount(0);
			await expect(page).toHaveURL('/');
			await expect(page.locator('[data-dialog-overlay]')).toHaveCount(0);
		}
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
		await expect(page.getByTestId('event-title')).toBeVisible({ timeout: 15000 });

		await expect(page.getByTestId('event-source-label')).toContainText('Tribehaus');
		await expect(page.getByTestId('event-register-link')).toBeVisible();
	});

	test('heilnetz source shows source link instead of registration button', async ({ page }) => {
		await clearTestEvents(page);
		const { event } = await createEvent(page, createYogaEvent());

		await page.goto(`/${event.slug}`);
		await expect(page.getByTestId('event-title')).toBeVisible({ timeout: 15000 });

		await expect(page.getByTestId('event-source-link')).toBeVisible();
		await expect(page.getByTestId('event-register-link')).toHaveCount(0);
		await expect(page.getByTestId('event-source-label')).toContainText('Heilnetz');
	});

	test('telegram source hides source label section', async ({ page }) => {
		await clearTestEvents(page);
		const { event } = await createEvent(page, createTelegramEvent());

		await page.goto(`/${event.slug}`);
		await expect(page.getByTestId('event-title')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('event-source-label')).toHaveCount(0);
	});
});

test.describe('Navigation Menu', () => {
	test.beforeEach(async ({ page }) => {
		await signInAsE2EUser(page);
		await clearTestEvents(page);
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		await page.getByTestId('event-card').first().waitFor({ timeout: 15000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('create event page is accessible while logged out', async ({ page }) => {
		await page.context().clearCookies();
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await page.goto('/events/new', { waitUntil: 'domcontentloaded' });
				break;
			} catch {
				if (attempt === 2) throw new Error(`Failed to open /events/new after 3 attempts`);
				await page.waitForTimeout(400);
			}
		}
		await expect(page.locator('body')).toBeVisible();
		await expect(page.getByTestId('create-event-heading')).toHaveAttribute('data-step', 'event');
		await expect(page.getByTestId('event-email-input')).toBeVisible();
	});

	test('event sources page is accessible', async ({ page }) => {
		// Occasional net::ERR_ABORTED when a prior navigation has not fully settled
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				await page.goto('/sources', { waitUntil: 'domcontentloaded' });
				break;
			} catch {
				if (attempt === 2) throw new Error(`Failed to open /sources after 3 attempts`);
				await page.waitForTimeout(400);
			}
		}
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
		await expect(page.getByTestId('event-title')).toBeVisible();
	});

	test('eventSlug query opens a dialog and dismissing does not reopen it', async ({ page }) => {
		await clearTestEvents(page);
		const { event } = await createEvent(page, createMeditationEvent({ slug: 'query-dismiss-event' }));

		await page.goto(`/?eventSlug=${encodeURIComponent(event.slug)}`);
		const dialog = page.getByTestId('details-dialog');
		await expect(dialog).toBeVisible({ timeout: 15000 });
		await expect(dialog.getByTestId('event-title')).toBeVisible();
		await expect(page).toHaveURL(new RegExp(`/${event.slug}$`));

		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(page).toHaveURL('/');
		// Stay closed after history/query sync settles (reopen regression).
		await page.waitForTimeout(500);
		await expect(page.getByTestId('details-dialog')).toHaveCount(0);
		await expect(page).toHaveURL('/');
	});
});
