import { describe, expect, it } from "vitest";
import {
	getAddress,
	getContact,
	getEndAt,
	getHost,
	getHostLink,
	getImageUrls,
	getName,
	getPrice,
	getSourceUrl,
	getStartAt,
	getTags,
	rowToEvent,
} from "./scrape-seeevents.ts";

const baseRow = {
	id_event: `41e8ff07-45d4-4b7e-a133-5a902b0358e4`,
	title: `Echoes of Stillness Meditation & Soundhealing Experience at Jiwa Garden`,
	slug: `echoes-of-stillness-meditation-soundhealing-at-jiwa-garden`,
	date_time: `2026-11-24T10:00:00+00:00`,
	end_date_time: `2026-11-24T12:00:00+00:00`,
	description: `Come early, bring a friend.\nSee you in the garden!`,
	image_url: `https://ozndlmuucdquwjrunqhg.supabase.co/storage/v1/object/public/event-images/example.jpg`,
	image_top_url: null,
	image_share_url: null,
	categories: [`wellness`],
	price: `donation`,
	latitude: -8.631727,
	longitude: 115.1360481,
	area: null,
	address_override: null,
	ticket_buy_url: null,
	event_instagram_url: `https://www.instagram.com/jiwagarden/`,
	artists_links: [`soundhealer`],
	music_genre: null,
	whatsapp_number_override: `+62 813 1234 5678`,
	review_status: `published`,
	market: `bali`,
};

describe(`getName`, () => {
	it(`trims the title`, () => {
		expect(getName({ ...baseRow, title: `  Full Moon Party  ` })).toBe(`Full Moon Party`);
		expect(getName({ ...baseRow, title: null })).toBeUndefined();
	});
});

describe(`getAddress`, () => {
	it(`pulls venue from title and always ends with Bali`, () => {
		expect(getAddress(baseRow)).toEqual([`Jiwa Garden`, `Bali`]);
	});

	it(`prefers address_override and keeps area`, () => {
		expect(
			getAddress({
				...baseRow,
				title: `DJ Night`,
				address_override: `Jl. Example 1`,
				area: `Canggu`,
			}),
		).toEqual([`Jl. Example 1`, `Canggu`, `Bali`]);
	});
});

describe(`timestamps`, () => {
	it(`converts UTC API times into Asia/Makassar offsets`, () => {
		expect(getStartAt(baseRow)).toBe(`2026-11-24T18:00:00+08:00`);
		expect(getEndAt(baseRow)).toBe(`2026-11-24T20:00:00+08:00`);
	});
});

describe(`media and contact`, () => {
	it(`maps images, tags, host, and contact links`, () => {
		expect(getImageUrls(baseRow)).toEqual([baseRow.image_url]);
		expect(getTags(baseRow)).toEqual([`wellness`]);
		expect(getHost(baseRow)).toBe(`soundhealer`);
		expect(getHostLink(baseRow)).toBe(`https://www.instagram.com/jiwagarden/`);
		expect(getContact(baseRow)).toEqual([
			`https://www.instagram.com/jiwagarden/`,
			`https://instagram.com/soundhealer`,
			`https://wa.me/6281312345678`,
		]);
		expect(
			getContact({
				...baseRow,
				event_instagram_url: null,
				artists_links: null,
				whatsapp_number_override: null,
				ticket_buy_url: `https://linktr.ee/balichronicleshttps://booketing.com/microsite/see/`,
			}),
		).toEqual([`https://linktr.ee/balichronicles`, `https://booketing.com/microsite/see/`]);
		expect(getPrice(baseRow)).toBe(`donation`);
		expect(getSourceUrl(baseRow)).toBe(
			`https://app.see.events/event/echoes-of-stillness-meditation-soundhealing-at-jiwa-garden`,
		);
	});
});

describe(`rowToEvent`, () => {
	it(`keeps whitelist wellness titles`, () => {
		const event = rowToEvent(baseRow);
		expect(event?.name).toBe(baseRow.title);
		expect(event?.source).toBe(`seeevents`);
		expect(event?.timezone).toBe(`Asia/Makassar`);
		expect(event?.latitude).toBeCloseTo(-8.631727);
		expect(event?.description).toContain(`<p>`);
	});

	it(`drops blacklist titles`, () => {
		expect(
			rowToEvent({
				...baseRow,
				title: `Bali Pub Crawl Seminyak`,
				description: null,
				categories: [`other`],
			}),
		).toBeUndefined();
	});
});
