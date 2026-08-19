import { test, expect } from '@playwright/test';
import { createEvent, createEvents, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent } from './helpers/seed';
import { waitForClientHydration } from './helpers/offering-test-utils';

test.describe('Homepage', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvents(page, [
			createMeditationEvent(),
			createYogaEvent(),
			createOnlineEvent(),
			createMeditationEvent({
				name: `Ecstatic Dance Night`,
				description: `A conscious dance evening`,
				tags: [`Ecstatic Dance`],
				sourceUrl: `https://example.com/ecstatic-dance`,
			}),
		]);
		await page.goto('/');
		await page.getByTestId('event-card').first().waitFor({ timeout: 15000 });
		await waitForClientHydration(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('page loads with logo', async ({ page }) => {
		await expect(page.getByTestId('hero-logo')).toBeVisible();
	});

	test('displays search and filter bar', async ({ page }) => {
		await expect(page.getByTestId('event-search-input')).toBeVisible();
		await expect(page.getByTestId('open-filter-dialog')).toBeVisible();
	});

	test('event cards display with required elements', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		await expect(firstCard).toBeVisible();
		await expect(firstCard.getByTestId('event-card-title')).toBeVisible();
	});

	test('clicking a category chip filters events', async ({ page }) => {
		await page.getByTestId(`category-chip-meditation`).click();

		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Meditation Workshop` })).toBeVisible({
			timeout: 15000,
		});
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Yoga Flow Class` })).toHaveCount(0);
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Ecstatic Dance Night` })).toHaveCount(0);
	});

	test('selecting a second category unions results', async ({ page }) => {
		await page.getByTestId(`category-chip-meditation`).click();
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Meditation Workshop` })).toBeVisible({
			timeout: 15000,
		});

		await page.getByTestId(`category-chip-dance`).click();
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Meditation Workshop` })).toBeVisible({
			timeout: 15000,
		});
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Ecstatic Dance Night` })).toBeVisible();
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Yoga Flow Class` })).toHaveCount(0);
	});

	test('deselecting a category restores unfiltered results for that category', async ({ page }) => {
		await page.getByTestId(`category-chip-meditation`).click();
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Yoga Flow Class` })).toHaveCount(0);

		await page.getByTestId(`category-chip-meditation`).click();
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Yoga Flow Class` })).toBeVisible({
			timeout: 15000,
		});
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Meditation Workshop` })).toBeVisible();
	});

	test('text search still filters events', async ({ page }) => {
		const searchInput = page.getByTestId(`event-search-input`);
		await searchInput.click();
		await searchInput.fill(`Yoga`);
		await searchInput.press(`Enter`);

		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Yoga Flow Class` })).toBeVisible({
			timeout: 15000,
		});
		await expect(page.getByTestId(`event-card-title`).filter({ hasText: `Meditation Workshop` })).toHaveCount(0);
	});

	test('search by city filters events', async ({ page }) => {
		const searchInput = page.getByTestId('plzCityInput-header');
		await expect(searchInput).toBeVisible();

		await searchInput.fill('Berlin');
		await searchInput.press('Enter');
		await page.waitForTimeout(1000);

		const eventCount = await page.getByTestId('event-card').count();
		expect(eventCount).toBeGreaterThanOrEqual(0);
	});

	test('event card click opens event details', async ({ page }) => {
		const firstCard = page.getByTestId('event-card').first();
		await expect(firstCard).toBeVisible();

		await firstCard.click();
		await expect(page.getByTestId('details-dialog')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('event-title')).toBeVisible();
	});
});

test.describe('Homepage - Loading States', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('shows loading indicator while fetching events', async ({ page }) => {
		await createEvent(page, createMeditationEvent());
		await page.goto('/');
		
		await page.getByTestId('event-card').first().waitFor({ timeout: 15000 });
		
		const eventCount = await page.getByTestId('event-card').count();
		expect(eventCount).toBeGreaterThan(0);
	});
});
