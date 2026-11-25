export const SCRAPER_COUNTRY_GROUPS = {
	bali: { label: `Bali` },
	germany: { label: `Germany` },
	austria: { label: `Austria` },
	switzerland: { label: `Switzerland` },
	vietnam: { label: `Vietnam` },
	global: { label: `global` },
} as const;

export type ScraperCountryGroup = keyof typeof SCRAPER_COUNTRY_GROUPS;

/** Cookie / filter value for a country group, e.g. `country:bali`. */
export const SCRAPER_COUNTRY_GROUP_PREFIX = `country:`;

export const WEBSITE_SCRAPER_CONFIG = {
	tribehaus: { module: "./scrape-tribehaus.ts", label: "Tribehaus", url: "https://tribehaus.app", country: `germany` },
	heilnetz: { module: "./scrape-heilnetz.ts", label: "Heilnetz", url: "https://heilnetz.de", country: `germany` },
	heilnetzowl: { module: "./scrape-heilnetzowl.ts", label: "Heilnetz OWL", url: "https://www.heilnetz-owl.de", country: `germany` },
	seijetzt: { module: "./scrape-seijetzt.ts", label: "Sei.Jetzt", url: "https://sei.jetzt", country: `germany` },
	ggbrandenburg: {
		module: "./scrape-ggbrandenburg.ts",
		label: "Ganzheitlich Gesund Brandenburg",
		url: "https://www.ganzheitlich-gesund-brandenburg.de",
		country: `germany`,
	},
	kuschelraum: { module: "./scrape-kuschelraum.ts", label: "Kuschelraum", url: "https://kuschelraum.de", country: `germany` },
	ciglobalcalendar: {
		module: "./scrape-ciglobalcalendar.ts",
		label: "CI Globalcalendar",
		url: "https://ciglobalcalendar.net",
		country: `germany`,
	},
	todotoday: { module: "./scrape-todotoday.ts", label: "Todo.Today", url: "https://todo.today", country: `global` },
	// vortexapp: { module: './scrape-vortexapp.ts', label: 'Vortexapp', url: 'https://vortexapp.dev' },
	megatix_indonesia: {
		module: "./scrape-megatix_indonesia.ts",
		label: "Megatix Indonesia",
		url: "https://megatix.co.id",
		country: `bali`,
	},
	eventbyindonesia: {
		module: "./scrape-eventbyindonesia.ts",
		label: "Event by Indonesia",
		url: "https://eventbyindonesia.id",
		country: `bali`,
	},
	whatsupdanang: { module: "./scrape-whatsupdanang.ts", label: "WhatsUpDaNang", url: "https://whatsupdanang.com", country: `vietnam` },
	whatsnewindonesia: {
		module: "./scrape-whatsnewindonesia.ts",
		label: "What's New Indonesia",
		url: "https://whatsnewindonesia.com",
		country: `bali`,
	},
	soulwise: { module: "./scrape-soulwise.ts", label: "Soulwise", url: "https://soulwise.io", country: `bali` },
	balievents: { module: "./scrape-balievents.ts", label: "BaliEvents.co", url: "https://www.balievents.co", country: `bali` },
	knowbali: { module: "./scrape-knowbali.ts", label: "KnowBali", url: "https://baliconnect-3a159.web.app", country: `bali` },
	knowmadsbali: { module: "./scrape-knowmadsbali.ts", label: "Knowmads Bali", url: "https://knowmadsbali.com", country: `bali` },
	balibuddy: { module: "./scrape-balibuddy.ts", label: "Bali Buddy", url: "https://balibuddy.app", country: `bali` },
	balibyanilau: { module: "./scrape-balibyanilau.ts", label: "Bali by Anilau", url: "https://bali.anilau.com", country: `bali` },
	balilive: { module: "./scrape-balilive.ts", label: "Bali Live", url: "https://bali.live", country: `bali` },
	visitbali: { module: "./scrape-visitbali.ts", label: "VisitBali", url: "https://visitbali.id", country: `bali` },
	whatsonbali: { module: "./scrape-whatsonbali.ts", label: "What's On Bali", url: "https://whatsonbali.com", country: `bali` },
	balifolio: { module: "./scrape-balifolio.ts", label: "BaliFolio", url: "https://balifolio.com", country: `bali` },
	balibuddies: { module: "./scrape-balibuddies.ts", label: "Bali Buddies", url: "https://balibuddies.com", country: `bali` },
	balicom: { module: "./scrape-balicom.ts", label: "Bali.com", url: "https://bali.com", country: `bali` },
	balitravelhub: {
		module: "./scrape-balitravelhub.ts",
		label: "Bali Travel Hub",
		url: "https://www.balitravelhub.com",
		country: `bali`,
	},
	cooleventasia: { module: "./scrape-cooleventasia.ts", label: "Cool Event Asia", url: "https://cooleventasia.com", country: `bali` },
	goers: { module: "./scrape-goers.ts", label: "GOERS", url: "https://www.goersapp.com", country: `bali` },
	nowbali: { module: "./scrape-nowbali.ts", label: "NOW! Bali", url: "https://www.nowbali.co.id", country: `bali` },
	seeevents: { module: "./scrape-seeevents.ts", label: "SEE Events Bali", url: "https://app.see.events", country: `bali` },
	yogabarn: {
		module: "./scrape-yogabarn.ts",
		label: "The Yoga Barn",
		url: "https://theyogabarn.com",
		retryOnNewIp: true,
		country: `bali`,
	},
	tantrakalender: { module: "./scrape-tantrakalender.ts", label: "Tantrakalender", url: "https://tantrakalender.de", country: `germany` },
	tantrazentrumleipzig: {
		module: "./scrape-tantrazentrumleipzig.ts",
		label: "Tantrazentrum Leipzig",
		url: "https://www.tantrazentrum-leipzig.de",
		country: `germany`,
	},
	consciousevents: {
		module: "./scrape-consciousevents.ts",
		label: "conscious events",
		url: "https://conscious-events.com",
		country: `germany`,
	},
	dieliebelle: { module: "./scrape-dieliebelle.ts", label: "DIE LIEBE.LLE", url: "https://www.die-liebelle.de", country: `germany` },
	createparty: { module: "./scrape-createparty.ts", label: "create.party", url: "https://create.party", country: `germany` },
	wimhofmethod: {
		module: "./scrape-wimhofmethod.ts",
		label: "Wim Hof Method",
		url: "https://activities.wimhofmethod.com",
		country: `global`,
	},
	meetup: { module: "./scrape-meetup.ts", label: "Meetup", url: "https://www.meetup.com", country: `global` },
	eventbrite: { module: "./scrape-eventbrite.ts", label: "Eventbrite", url: "https://www.eventbrite.com", country: `global` },
	humanitix: { module: "./scrape-humanitix.ts", label: "Humanitix", url: "https://humanitix.com", country: `global` },
	miteinandersein: {
		module: "./scrape-miteinandersein.ts",
		label: "MiteinanderSein",
		url: "https://www.miteinandersein.net",
		country: `germany`,
	},
	yogavidya: { module: "./scrape-yoga-vidya.ts", label: "Yoga Vidya", url: "https://www.yoga-vidya.de", country: `germany` },
	kayana: { module: "./scrape-kayana.ts", label: "Kayana", url: "https://dein-kayana.de", country: `germany` },
	soulcollective: {
		module: "./scrape-soulcollective.ts",
		label: "Soul Collective",
		url: "https://www.soulcollective.eu",
		country: `germany`,
	},
	fitra: { module: "./scrape-fitra.ts", label: "FITRA", url: "https://fitra.asia", country: `bali` },
	facebook: { module: "./scrape-facebook.ts", label: "Facebook Events", url: "https://www.facebook.com/events/", country: `global` },
	// lumaya: { module: './scrape-lumaya.ts' } wollen die mich verklagen?
} as const satisfies Record<
	string,
	{ module: string; label: string; url: string; country: ScraperCountryGroup; retryOnNewIp?: boolean }
>;

export const WEBSITE_SCRAPE_SOURCES = Object.keys(WEBSITE_SCRAPER_CONFIG) as (keyof typeof WEBSITE_SCRAPER_CONFIG)[];

export type WebsiteScrapeSourceName = (typeof WEBSITE_SCRAPE_SOURCES)[number];

export const WEBSITE_SCRAPE_SOURCE_URLS = Object.values(WEBSITE_SCRAPER_CONFIG).map((x) => x.url);

export function scraperCountryGroupFilterValue(country: ScraperCountryGroup) {
	return `${SCRAPER_COUNTRY_GROUP_PREFIX}${country}`;
}

export function parseScraperCountryGroupFilter(value: string | null | undefined): ScraperCountryGroup | null {
	const trimmed = value?.trim();
	if (!trimmed?.startsWith(SCRAPER_COUNTRY_GROUP_PREFIX)) return null;

	const country = trimmed.slice(SCRAPER_COUNTRY_GROUP_PREFIX.length);
	if (!(country in SCRAPER_COUNTRY_GROUPS)) return null;
	return country as ScraperCountryGroup;
}

export function getSourcesForScraperCountryGroup(country: ScraperCountryGroup) {
	return WEBSITE_SCRAPE_SOURCES.filter((source) => WEBSITE_SCRAPER_CONFIG[source].country === country);
}

/** Country groups that currently have at least one scraper, in display order. */
export function getPopulatedScraperCountryGroups() {
	const order = Object.keys(SCRAPER_COUNTRY_GROUPS) as ScraperCountryGroup[];
	return order.filter((country) => getSourcesForScraperCountryGroup(country).length);
}

/**
 * Resolves an admin source filter cookie/param to concrete `events.source` values.
 * `null` / empty / `all` → no source restriction.
 * `country:bali` → all scrapers in that group.
 * Otherwise → single source key.
 */
export function resolveEventSourceFilter(value: string | null | undefined): string[] | null {
	const trimmed = value?.trim();
	if (!trimmed || trimmed === `all`) return null;

	const country = parseScraperCountryGroupFilter(trimmed);
	if (country) {
		const sources = getSourcesForScraperCountryGroup(country);
		return sources.length ? sources : null;
	}

	return [trimmed];
}

export function getEventSourceFilterLabel(value: string) {
	const country = parseScraperCountryGroupFilter(value);
	if (country) return SCRAPER_COUNTRY_GROUPS[country].label;

	if (value in WEBSITE_SCRAPER_CONFIG) {
		return WEBSITE_SCRAPER_CONFIG[value as WebsiteScrapeSourceName].label;
	}

	return value;
}
