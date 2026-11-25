import { describe, expect, it } from "vitest";
import {
	getPopulatedScraperCountryGroups,
	getSourcesForScraperCountryGroup,
	parseScraperCountryGroupFilter,
	resolveEventSourceFilter,
	scraperCountryGroupFilterValue,
	SCRAPER_COUNTRY_GROUPS,
	WEBSITE_SCRAPE_SOURCES,
	WEBSITE_SCRAPER_CONFIG,
} from "./commonWithScripts";

describe(`scraper country groups`, () => {
	it(`assigns every website scraper a known country group`, () => {
		for (const source of WEBSITE_SCRAPE_SOURCES) {
			expect(WEBSITE_SCRAPER_CONFIG[source].country in SCRAPER_COUNTRY_GROUPS).toBe(true);
		}
	});

	it(`puts multi-country platforms in global`, () => {
		for (const source of [`meetup`, `eventbrite`, `humanitix`, `facebook`, `wimhofmethod`, `todotoday`] as const) {
			expect(WEBSITE_SCRAPER_CONFIG[source].country).toBe(`global`);
		}
	});

	it(`groups Bali / Indonesia scrapers under bali`, () => {
		expect(getSourcesForScraperCountryGroup(`bali`)).toContain(`balievents`);
		expect(getSourcesForScraperCountryGroup(`bali`)).toContain(`megatix_indonesia`);
		expect(getSourcesForScraperCountryGroup(`vietnam`)).toEqual([`whatsupdanang`]);
	});

	it(`only lists populated groups in the admin dropdown order`, () => {
		const groups = getPopulatedScraperCountryGroups();
		expect(groups).toContain(`bali`);
		expect(groups).toContain(`germany`);
		expect(groups).toContain(`vietnam`);
		expect(groups).toContain(`global`);
		expect(groups).not.toContain(`austria`);
		expect(groups).not.toContain(`switzerland`);
	});

	it(`resolves country filters to source lists and keeps single sources`, () => {
		expect(resolveEventSourceFilter(null)).toBeNull();
		expect(resolveEventSourceFilter(`all`)).toBeNull();
		expect(resolveEventSourceFilter(`tribehaus`)).toEqual([`tribehaus`]);

		const baliFilter = scraperCountryGroupFilterValue(`bali`);
		expect(parseScraperCountryGroupFilter(baliFilter)).toBe(`bali`);
		expect(resolveEventSourceFilter(baliFilter)).toEqual(getSourcesForScraperCountryGroup(`bali`));
	});
});
