import { expect, test } from '@playwright/test';
import { clearTestEvents, createEvent, getEventById } from './helpers/seed';

test.describe('Edit event images', () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test('can remove, add, and persist edited images', async ({ page }) => {
		const existingImageUrls = [
			`https://assets.blissbase.app/e2e-existing/cover-1.webp`,
			`https://assets.blissbase.app/e2e-existing/cover-2.webp`,
			`https://assets.blissbase.app/e2e-existing/cover-3.webp`
		];
		const { event } = await createEvent(page, {
			name: `Editable image event`,
			attendanceMode: `online`,
			address: [],
			imageUrls: existingImageUrls,
			hostSecret: `test-secret`
		});

		await page.goto(`/edit/${event.id}?hostSecret=${event.hostSecret}`);
		await expect(page.getByTestId(`event-edit-heading`)).toBeVisible();
		await expect(page.getByTestId(`image-preview-item`)).toHaveCount(3);

		await page.getByTestId(`image-preview-remove`).nth(1).click();
		await expect(page.getByTestId(`image-preview-item`)).toHaveCount(2);

		await page.getByTestId(`image-input`).setInputFiles({
			name: `added-image.png`,
			mimeType: `image/png`,
			buffer: createTinyPngBuffer()
		});
		await expect(page.getByTestId(`image-preview-item`)).toHaveCount(3);
		await expect(page.getByTestId(`image-preview-item`).nth(2)).toContainText(`added-image.png`);
		await expect(page.getByTestId(`image-preview-item`).nth(2)).toHaveAttribute(`data-upload-state`, `ready`, {
			timeout: 30000
		});

		await page.getByTestId(`event-save`).click();
		await page.waitForURL(`**/${event.slug}`);

		await expect
			.poll(async () => {
				const result = await getEventById(page, event.id);
				const imageUrls = result.event?.imageUrls ?? [];
				return {
					length: imageUrls.length,
					first: imageUrls[0],
					second: imageUrls[1],
					thirdIsE2e: imageUrls[2]?.includes(`/e2e/events/`) ?? false,
				};
			})
			.toEqual({
				length: 3,
				first: existingImageUrls[0],
				second: existingImageUrls[2],
				thirdIsE2e: true,
			});
	});
});

test.describe(`Edit past event`, () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test(`can save an event that already started`, async ({ page }) => {
		const { event } = await createEvent(page, {
			name: `Past workshop`,
			attendanceMode: `online`,
			address: [],
			startAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
			hostSecret: `test-secret`
		});

		await page.goto(`/edit/${event.id}?hostSecret=${event.hostSecret}`);
		await expect(page.getByTestId(`event-edit-heading`)).toBeVisible();
		await expect(page.getByTestId(`event-name-input`)).toHaveValue(`Past workshop`);

		await page.getByTestId(`event-name-input`).fill(`Past workshop (korrigiert)`);
		await page.getByTestId(`event-save`).click();
		await page.waitForURL(`**/${event.slug}`);

		await expect
			.poll(async () => {
				const result = await getEventById(page, event.id);
				return result.event?.name;
			})
			.toBe(`Past workshop (korrigiert)`);
	});
});

function createTinyPngBuffer() {
	return Buffer.from(
		`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pGdb9sAAAAASUVORK5CYII=`,
		`base64`
	);
}
