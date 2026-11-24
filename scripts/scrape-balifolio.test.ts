import { describe, expect, it } from "vitest";
import { mapBaliFolioEvent } from "./scrape-balifolio.ts";

const row = {
	id: 42,
	title: ` Full Moon Cacao Ceremony `,
	slug: `full-moon-cacao-ceremony-2026-11-24`,
	category: `Ceremony`,
	area: `Ubud`,
	date: `2026-11-24T00:00:00.000Z`,
	time: `19:00`,
	endDate: null,
	endTime: `21:30`,
	venue: `The Mesa Bali`,
	venueRef: 123,
	price: 250000,
	frequency: `one-off`,
	description: `Join us for cacao.\n\nBring a mat.`,
	heroImageUrl: `/api/media/file/cacao.jpg?prefix=bali-folio`,
	sourceUrl: `https://example.com/cacao`,
	bookingUrl: `https://megatix.co.id/events/cacao`,
	status: `PUBLISHED`,
	autoHidden: false,
};

const venue = {
	id: 123,
	name: `The Mesa Bali - Berawa`,
	slug: `the-mesa-bali-berawa`,
	address: `Jl. Pantai Berawa`,
	area: `Canggu/Berawa/Pererenan`,
	lat: -8.65,
	lng: 115.15,
	website: `https://mesa.example`,
	phone: `+62 812-3456-7890`,
	whatsapp: `6281234567890`,
	instagram: `mesabali`,
	email: `hello@mesa.example`,
};

describe(`mapBaliFolioEvent`, () => {
	it(`maps API row + directory venue onto a scraped event`, () => {
		const mapped = mapBaliFolioEvent({ row, venue });

		expect(mapped).toMatchObject({
			name: `Full Moon Cacao Ceremony`,
			startAt: `2026-11-24T19:00:00+08:00`,
			endAt: `2026-11-24T21:30:00+08:00`,
			timezone: `Asia/Makassar`,
			price: `IDR 250.000`,
			priceIsHtml: false,
			host: `The Mesa Bali - Berawa`,
			hostLink: `https://mesa.example`,
			latitude: -8.65,
			longitude: 115.15,
			tags: [`Ceremony`],
			sourceUrl: `https://balifolio.com/events/full-moon-cacao-ceremony-2026-11-24`,
			source: `balifolio`,
		});
		expect(mapped?.address).toEqual([
			`The Mesa Bali - Berawa`,
			`Jl. Pantai Berawa`,
			`The Mesa Bali`,
			`Canggu/Berawa/Pererenan`,
		]);
		expect(mapped?.imageUrls).toEqual([`https://balifolio.com/api/media/file/cacao.jpg?prefix=bali-folio`]);
		expect(mapped?.description).toContain(`<p>Join us for cacao.</p>`);
		expect(mapped?.description).toContain(`<p>Bring a mat.</p>`);
		expect(mapped?.contact).toEqual(
			expect.arrayContaining([
				`https://wa.me/6281234567890`,
				`+62 812-3456-7890`,
				`https://instagram.com/mesabali`,
				`hello@mesa.example`,
				`https://megatix.co.id/events/cacao`,
				`https://example.com/cacao`,
				`https://mesa.example`,
			]),
		);
	});

	it(`rolls endTime past midnight to the next day`, () => {
		const mapped = mapBaliFolioEvent({
			row: { ...row, time: `20:00`, endTime: `01:00` },
		});
		expect(mapped?.startAt).toBe(`2026-11-24T20:00:00+08:00`);
		expect(mapped?.endAt).toBe(`2026-11-25T01:00:00+08:00`);
	});

	it(`skips events without a name or start`, () => {
		expect(mapBaliFolioEvent({ row: { ...row, title: `  ` } })).toBeUndefined();
		expect(mapBaliFolioEvent({ row: { ...row, date: null } })).toBeUndefined();
	});

	it(`formats free prices and absolute hero images`, () => {
		expect(mapBaliFolioEvent({ row: { ...row, price: 0 } })?.price).toBe(`Free`);
		expect(
			mapBaliFolioEvent({
				row: { ...row, heroImageUrl: `https://cdn.example/poster.jpg` },
			})?.imageUrls,
		).toEqual([`https://cdn.example/poster.jpg`]);
	});
});
