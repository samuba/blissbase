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
		await expect(page.getByRole(`heading`, { name: /Event bearbeiten|Edit event/i })).toBeVisible();
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
		// Submitting before client-side processing finishes leaves `data.images` empty on the server
		await expect(page.getByTestId(`image-preview-item`).nth(2).getByTestId(`image-preview-move-left`)).toBeEnabled({
			timeout: 30000
		});

		await page.getByRole(`button`, { name: /Speichern|Save/i }).click();
		await page.waitForURL(`**/${event.slug}`);

		await expect
			.poll(async () => {
				const result = await getEventById(page, event.id);
				return result.event?.imageUrls ?? [];
			})
			.toEqual([
				existingImageUrls[0],
				existingImageUrls[2],
				`https://assets.blissbase.app/e2e/${event.slug}/0-added-image.webp`
			]);
	});
});

function createTinyPngBuffer() {
	return Buffer.from(
		`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pGdb9sAAAAASUVORK5CYII=`,
		`base64`
	);
}
