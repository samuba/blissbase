import { describe, expect, it, vi } from "vitest";
import { collectActivityPages, uniqueActivities, mapWhmActivity, whmDateToIso } from "./scrape-wimhofmethod.ts";

const html = `<!doctype html>
<html><head>
<meta property="og:url" content="https://activities.wimhofmethod.com/activities/atemklasse-muenster/71143"/>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Atemklasse",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "startDate": "2026-11-09CET19:00 ",
  "endDate": "2026-11-09CET20:00 ",
  "location": { "name": "Rudolf-Diesel-Straße 1, Münster, Germany" },
  "image": "https://media-cdn.wimhofmethod.com/uploads/cms/2023/05/img_activities-min.jpg",
  "offers": { "price": "15.00", "priceCurrency": "EUR" },
  "performer": { "name": "Levent Semercioglu" }
}
</script>
</head><body>
<div class="cms-editor"><p>Atme ruhig. Bringe eine Decke mit.</p></div>
<div>Language</div><div>German</div>
<a x-bind:href="'https://activities.wimhofmethod.com/checkout?productable_id=71143&amp;quantity='+qty">Buy now</a>
<div>05 Oct</div>
</body></html>`;

const listing = {
	title: `Atemklasse`,
	workshopSlug: `atemklasse-muenster`,
	workshopDateId: 71143,
	headerBackgroundURL: `https://media-cdn.wimhofmethod.com/uploads/workshops/cover.jpg`,
	isDefaultHeaderBackground: false,
	location: { city: `Münster`, country: `Germany` },
	language: `German`,
	categories: [{ title: `Breathing Class` }],
	trainerName: `Levent Semercioglu`,
	currency: `&euro;`,
	customerPrice: `16.50`,
};

describe(`whmDateToIso`, () => {
	it(`reads abbreviation and numeric offsets from the activity JSON-LD`, () => {
		expect(whmDateToIso(`2026-10-05CEST19:00 `)).toBe(`2026-10-05T19:00:00+02:00`);
		expect(whmDateToIso(`2026-11-09CET19:00`)).toBe(`2026-11-09T19:00:00+01:00`);
		expect(whmDateToIso(`2026-10-10PDT09:00`)).toBe(`2026-10-10T09:00:00-07:00`);
		expect(whmDateToIso(`2026-11-07NST09:00 `)).toBe(`2026-11-07T09:00:00-03:30`);
		expect(whmDateToIso(`2026-10-10+0309:45`)).toBe(`2026-10-10T09:45:00+03:00`);
		expect(whmDateToIso(`2026-10-10+053010:30`)).toBe(`2026-10-10T10:30:00+05:30`);
		expect(whmDateToIso(`not-a-date`)).toBeUndefined();
	});
});

describe(`mapWhmActivity`, () => {
	it(`maps the detail HTML for the requested occurrence, not an earlier date on the page`, () => {
		const mapped = mapWhmActivity({
			html,
			listing,
			url: `https://activities.wimhofmethod.com/activities/atemklasse-muenster/71143`,
		});

		expect(mapped).toMatchObject({
			name: `Atemklasse`,
			startAt: `2026-11-09T19:00:00+01:00`,
			endAt: `2026-11-09T20:00:00+01:00`,
			timezone: `Europe/Berlin`,
			address: [`Rudolf-Diesel-Straße 1`, `Münster`, `Germany`],
			price: `15€`,
			priceIsHtml: false,
			imageUrls: [`https://media-cdn.wimhofmethod.com/uploads/workshops/cover.jpg`],
			host: `Levent Semercioglu`,
			tags: [`German`, `Breathing Class`],
			sourceUrl: `https://activities.wimhofmethod.com/activities/atemklasse-muenster/71143`,
			source: `wimhofmethod`,
			contact: [
				`https://activities.wimhofmethod.com/checkout?productable_type=App%5CModels%5CWorkshopDate&productable_id=71143&quantity=1`,
			],
		});
		expect(mapped?.description).toContain(`Atme ruhig.`);
		expect(mapped?.startAt).not.toContain(`2026-10-05`);
	});
});

describe(`broken JSON-LD`, () => {
	it(`still reads the occurrence when the description string is invalid JSON`, () => {
		const broken = `<!doctype html><html><head>
<meta property="og:url" content="https://activities.wimhofmethod.com/activities/ice-oslo/80001"/>
<script type="application/ld+json">
{
  "@type": "Event",
  "name": "Ice bath",
  "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
  "location": { "name": "Harbor 1, Oslo, Norway" },
  "description": "Line one
line two",
  "startDate": "2026-12-01CET18:00 ",
  "endDate": "2026-12-01CET20:00 ",
  "offers": { "price": "40.50", "priceCurrency": "EUR" },
  "performer": { "name": "Ada" }
}
</script>
</head><body><div class="cms-editor"><p>Kalt duschen.</p></div></body></html>`;

		const mapped = mapWhmActivity({
			html: broken,
			listing: {
				title: `Ice bath`,
				workshopSlug: `ice-oslo`,
				workshopDateId: 80001,
				location: { city: `Oslo`, country: `Norway` },
				categories: [{ title: `Fundamentals Workshop` }],
			},
			url: `https://activities.wimhofmethod.com/activities/ice-oslo/80001`,
		});

		expect(mapped).toMatchObject({
			name: `Ice bath`,
			startAt: `2026-12-01T18:00:00+01:00`,
			endAt: `2026-12-01T20:00:00+01:00`,
			address: [`Harbor 1`, `Oslo`, `Norway`],
			price: `40,50€`,
			host: `Ada`,
		});
	});
});

describe(`uniqueActivities`, () => {
	const base = mapWhmActivity({
		html,
		listing,
		url: `https://activities.wimhofmethod.com/activities/atemklasse-muenster/71143`,
	});
	if (!base) throw new Error(`expected base event`);
	const at = (startAt: string, endAt: string) => ({ ...base, startAt, endAt });

	it(`collapses co-host and ticket-tier listings of the same activity`, () => {
		const events = uniqueActivities([
			{ event: { ...base, host: `Dr. Martin Zeitz` }, city: `Düsseldorf` },
			{ event: { ...base, host: `Stefan Reiters` }, city: `Düsseldorf` },
		]);
		expect(events).toHaveLength(1);
		expect(events[0].name).toBe(`Atemklasse`);
	});

	it(`appends the city, then the start time, only where stored slugs would collide`, () => {
		const names = uniqueActivities([
			{ event: base, city: `Münster` },
			{ event: base, city: `Köln` },
			{ event: at(`2026-11-09T08:30:00+01:00`, `2026-11-09T12:30:00+01:00`), city: `Senlisse` },
			{ event: at(`2026-11-09T14:00:00+01:00`, `2026-11-09T18:00:00+01:00`), city: `Senlisse` },
			{ event: { ...base, name: `Ice bath` }, city: `Oslo` },
		]).map((event) => event.name);

		expect(names).toEqual([
			`Atemklasse · Münster`,
			`Atemklasse · Köln`,
			`Atemklasse · Senlisse · 08:30`,
			`Atemklasse · Senlisse · 14:00`,
			`Ice bath`,
		]);
	});
});

describe(`HTML entities in JSON-LD`, () => {
	it(`decodes host, name and address`, () => {
		const encoded = html
			.replace(`"name": "Atemklasse"`, `"name": "WHM Weekend &amp; Ice"`)
			.replace(`"Levent Semercioglu"`, `"Laurent D&#039;acunto"`)
			.replace(`Rudolf-Diesel-Straße 1`, `YOGA&amp;CO`);
		const mapped = mapWhmActivity({ html: encoded, listing, url: `https://activities.wimhofmethod.com/x/1` });
		expect(mapped).toMatchObject({
			name: `WHM Weekend & Ice`,
			host: `Laurent D'acunto`,
			address: [`YOGA&CO`, `Münster`, `Germany`],
		});
	});
});

describe(`collectActivityPages`, () => {
	it(`keeps going when one activity page fails`, async () => {
		const errorSpy = vi.spyOn(console, `error`).mockImplementation(() => {});
		const events = await collectActivityPages({
			listings: [
				listing,
				{ ...listing, workshopDateId: 1, workshopSlug: `broken`, title: `Broken` },
				{ ...listing, workshopDateId: 2, workshopSlug: `other`, title: `Other class` },
			],
			loadHtml: async (url) => {
				if (url.includes(`/broken/`)) throw new Error(`boom`);
				if (url.includes(`/other/`)) return html.replaceAll(`2026-11-09`, `2026-11-10`);
				return html;
			},
		});

		expect(events).toHaveLength(2);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
