import { describe, expect, it } from "vitest";
import {
	buildAdminEventSourceFilterOptions,
	getPopulatedScraperSourceGroups,
	getSourcesForScraperSourceGroup,
	parseScraperSourceGroupFilter,
	resolveEventSourceFilter,
	scraperSourceGroupFilterValue,
	SCRAPER_SOURCE_GROUPS,
	WEBSITE_SCRAPE_SOURCES,
	WEBSITE_SCRAPER_CONFIG,
} from "./commonWithScripts";

describe(`scraper source groups`, () => {
	it(`assigns every website scraper a known group`, () => {
		for (const source of WEBSITE_SCRAPE_SOURCES) {
			expect(WEBSITE_SCRAPER_CONFIG[source].group in SCRAPER_SOURCE_GROUPS).toBe(true);
		}
	});

	it(`puts multi-country platforms in global`, () => {
		for (const source of [`meetup`, `eventbrite`, `humanitix`, `facebook`, `wimhofmethod`, `todotoday`] as const) {
			expect(WEBSITE_SCRAPER_CONFIG[source].group).toBe(`global`);
		}
	});

	it(`groups Bali / Indonesia scrapers under bali`, () => {
		expect(getSourcesForScraperSourceGroup(`bali`)).toContain(`balievents`);
		expect(getSourcesForScraperSourceGroup(`bali`)).toContain(`megatix_indonesia`);
		expect(getSourcesForScraperSourceGroup(`vietnam`)).toEqual([`whatsupdanang`]);
	});

	it(`only lists populated groups in display order`, () => {
		const groups = getPopulatedScraperSourceGroups();
		expect(groups).toContain(`bali`);
		expect(groups).toContain(`germany`);
		expect(groups).toContain(`vietnam`);
		expect(groups).toContain(`global`);
		expect(groups).not.toContain(`austria`);
		expect(groups).not.toContain(`switzerland`);
	});

	it(`resolves group filters to source lists and keeps single sources`, () => {
		expect(resolveEventSourceFilter(null)).toBeNull();
		expect(resolveEventSourceFilter(`all`)).toBeNull();
		expect(resolveEventSourceFilter(`tribehaus`)).toEqual([`tribehaus`]);

		const baliFilter = scraperSourceGroupFilterValue(`bali`);
		expect(parseScraperSourceGroupFilter(baliFilter)).toBe(`bali`);
		expect(resolveEventSourceFilter(baliFilter)).toEqual(getSourcesForScraperSourceGroup(`bali`));
	});

	it(`builds admin options with sources under group headers, alphabetical within group`, () => {
		const options = buildAdminEventSourceFilterOptions([
			`tribehaus`,
			`heilnetz`,
			`meetup`,
			`whatsupdanang`,
			`balievents`,
			`telegram`,
			`yogabarn`,
		]);

		expect(options.map((o) => o.value)).toEqual([
			`all`,
			`__section-bali__`,
			`balievents`,
			`yogabarn`,
			`__section-germany__`,
			`heilnetz`,
			`tribehaus`,
			`__section-vietnam__`,
			`whatsupdanang`,
			`__section-global__`,
			`meetup`,
			`__section-other__`,
			`telegram`,
		]);
		expect(options.find((o) => o.value === `__section-bali__`)?.disabled).toBe(true);
		expect(options.find((o) => o.value === `balievents`)?.html).toBe(`BaliEvents.co`);
		expect(options.find((o) => o.value === `yogabarn`)?.html).toBe(`The Yoga Barn`);
	});
});
