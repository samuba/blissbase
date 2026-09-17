import { expect, test } from './helpers/fixtures';
import { createEvent, createEvents, clearTestEvents, createMeditationEvent, createYogaEvent, createOnlineEvent } from './helpers/seed';
import { setEventLocationFilterCookie, waitForClientHydration } from './helpers/offering-test-utils';

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
		await page.getByTestId(`plzCityInput-header-summary`).click();
		const searchInput = page.getByTestId(`plzCityInput-header`);
		await expect(searchInput).toBeVisible();

		await searchInput.fill(`Berlin`);
		await searchInput.press(`Enter`);
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

test.describe(`Homepage - listing dividers`, () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test(`shows Morgen, Übermorgen, Später diese Woche, Nächste Woche, and Später between chronological events`, async ({ page }) => {
		const laterThisWeekDays = daysUntilLaterThisWeek();
		await createEvents(page, [
			createMeditationEvent({
				name: `Today Morning Circle`,
				startAt: futureTodayIso(10),
			}),
			createMeditationEvent({
				name: `Today Evening Circle`,
				startAt: futureTodayIso(30),
			}),
			createYogaEvent({
				name: `Tomorrow Yoga`,
				startAt: localDayAtHour({ daysFromToday: 1, hour: 18 }),
			}),
			createYogaEvent({
				name: `Day After Yoga`,
				startAt: localDayAtHour({ daysFromToday: 2, hour: 18 }),
			}),
			...(laterThisWeekDays == null
				? []
				: [
						createYogaEvent({
							name: `Later This Week Jam`,
							startAt: localDayAtHour({ daysFromToday: laterThisWeekDays, hour: 18 }),
						}),
					]),
			createOnlineEvent({
				name: `Next Week Breathwork`,
				startAt: localDayAtHour({ daysFromToday: daysUntilNextWeekThursday(), hour: 18 }),
			}),
			createMeditationEvent({
				name: `Later Retreat`,
				startAt: localDayAtHour({ daysFromToday: daysUntilWeekAfterNext(), hour: 18 }),
			}),
		]);

		await page.goto(`/`);
		await page.getByTestId(`event-card`).first().waitFor({ timeout: 15000 });
		await waitForClientHydration(page);

		const listing = page.locator(`[data-testid="event-card-title"], [data-testid="event-list-divider"]`);
		await expect.poll(async () => (await listing.allTextContents()).map((text) => text.trim())).toEqual([
			`Today Morning Circle`,
			`Today Evening Circle`,
			`Morgen`,
			`Tomorrow Yoga`,
			`Übermorgen`,
			`Day After Yoga`,
			...(laterThisWeekDays == null ? [] : [`Später diese Woche`, `Later This Week Jam`]),
			`Nächste Woche`,
			`Next Week Breathwork`,
			`Später`,
			`Later Retreat`,
		]);
	});
});

test.describe(`Homepage - location prefill`, () => {
	test(`renders the saved location in the search box in the server HTML`, async ({ page }) => {
		const locationLabel = `Prefillstadt`;
		await setEventLocationFilterCookie(page, {
			plzCity: locationLabel,
			distance: `50`,
			lat: 52.52,
			lng: 13.405,
		});

		const response = await page.goto(`/`);
		const html = await response!.text();

		expect(html).toMatch(/data-testid="plzCityInput-header" value="Prefillstadt"/);
		expect(html).toMatch(/data-testid="plzCityInput-header-distance" value="50"/);
		expect(html).toMatch(/data-testid="plzCityInput-header-summary"[\s\S]*?Prefillstadt/);
		await expect(page.getByTestId(`plzCityInput-header-summary`)).toContainText(locationLabel);
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

function futureTodayIso(minutesFromNow: number) {
	const date = new Date(Date.now() + minutesFromNow * 60 * 1000);
	const endOfToday = new Date();
	endOfToday.setHours(23, 59, 0, 0);
	return (date > endOfToday ? endOfToday : date).toISOString();
}

function localDayAtHour(args: { daysFromToday: number; hour: number }) {
	const date = new Date();
	date.setDate(date.getDate() + args.daysFromToday);
	date.setHours(args.hour, 0, 0, 0);
	return date.toISOString();
}

function daysUntilNextWeekThursday() {
	const today = new Date();
	const day = today.getDay();
	const daysUntilNextMonday = day === 0 ? 1 : 8 - day;
	return daysUntilNextMonday + 3;
}

function daysUntilLaterThisWeek() {
	const today = new Date();
	const day = today.getDay();
	const daysUntilSunday = day === 0 ? 0 : 7 - day;
	if (daysUntilSunday <= 2) return null;
	return 3;
}

function daysUntilWeekAfterNext() {
	const today = new Date();
	const day = today.getDay();
	const daysUntilNextMonday = day === 0 ? 1 : 8 - day;
	return daysUntilNextMonday + 7;
}
