export const SCRAPER_SOURCE_GROUPS = {
	bali: { label: `Bali` },
	germany: { label: `Germany` },
	austria: { label: `Austria` },
	switzerland: { label: `Switzerland` },
	vietnam: { label: `Vietnam` },
	global: { label: `global` },
} as const;

export type ScraperSourceGroup = keyof typeof SCRAPER_SOURCE_GROUPS;

/** Cookie / filter value for a scraper group, e.g. `group:bali`. */
export const SCRAPER_SOURCE_GROUP_PREFIX = `group:`;

export const WEBSITE_SCRAPER_CONFIG = {
	tribehaus: { module: "./scrape-tribehaus.ts", label: "Tribehaus", url: "https://tribehaus.app", group: `germany` },
	heilnetz: { module: "./scrape-heilnetz.ts", label: "Heilnetz", url: "https://heilnetz.de", group: `germany` },
	heilnetzowl: { module: "./scrape-heilnetzowl.ts", label: "Heilnetz OWL", url: "https://www.heilnetz-owl.de", group: `germany` },
	seijetzt: { module: "./scrape-seijetzt.ts", label: "Sei.Jetzt", url: "https://sei.jetzt", group: `germany` },
	ggbrandenburg: {
		module: "./scrape-ggbrandenburg.ts",
		label: "Ganzheitlich Gesund Brandenburg",
		url: "https://www.ganzheitlich-gesund-brandenburg.de",
		group: `germany`,
	},
	kuschelraum: { module: "./scrape-kuschelraum.ts", label: "Kuschelraum", url: "https://kuschelraum.de", group: `germany` },
	ciglobalcalendar: {
		module: "./scrape-ciglobalcalendar.ts",
		label: "CI Globalcalendar",
		url: "https://ciglobalcalendar.net",
		group: `germany`,
	},
	todotoday: { module: "./scrape-todotoday.ts", label: "Todo.Today", url: "https://todo.today", group: `global` },
	// vortexapp: { module: './scrape-vortexapp.ts', label: 'Vortexapp', url: 'https://vortexapp.dev' },
	megatix_indonesia: {
		module: "./scrape-megatix_indonesia.ts",
		label: "Megatix Indonesia",
		url: "https://megatix.co.id",
		group: `bali`,
	},
	eventbyindonesia: {
		module: "./scrape-eventbyindonesia.ts",
		label: "Event by Indonesia",
		url: "https://eventbyindonesia.id",
		group: `bali`,
	},
	whatsupdanang: { module: "./scrape-whatsupdanang.ts", label: "WhatsUpDaNang", url: "https://whatsupdanang.com", group: `vietnam` },
	whatsnewindonesia: {
		module: "./scrape-whatsnewindonesia.ts",
		label: "What's New Indonesia",
		url: "https://whatsnewindonesia.com",
		group: `bali`,
	},
	soulwise: { module: "./scrape-soulwise.ts", label: "Soulwise", url: "https://soulwise.io", group: `bali` },
	balievents: { module: "./scrape-balievents.ts", label: "BaliEvents.co", url: "https://www.balievents.co", group: `bali` },
	knowbali: { module: "./scrape-knowbali.ts", label: "KnowBali", url: "https://baliconnect-3a159.web.app", group: `bali` },
	knowmadsbali: { module: "./scrape-knowmadsbali.ts", label: "Knowmads Bali", url: "https://knowmadsbali.com", group: `bali` },
	balibuddy: { module: "./scrape-balibuddy.ts", label: "Bali Buddy", url: "https://balibuddy.app", group: `bali` },
	balibyanilau: { module: "./scrape-balibyanilau.ts", label: "Bali by Anilau", url: "https://bali.anilau.com", group: `bali` },
	balilive: { module: "./scrape-balilive.ts", label: "Bali Live", url: "https://bali.live", group: `bali` },
	visitbali: { module: "./scrape-visitbali.ts", label: "VisitBali", url: "https://visitbali.id", group: `bali` },
	whatsonbali: { module: "./scrape-whatsonbali.ts", label: "What's On Bali", url: "https://whatsonbali.com", group: `bali` },
	balifolio: { module: "./scrape-balifolio.ts", label: "BaliFolio", url: "https://balifolio.com", group: `bali` },
	balibuddies: { module: "./scrape-balibuddies.ts", label: "Bali Buddies", url: "https://balibuddies.com", group: `bali` },
	balicom: { module: "./scrape-balicom.ts", label: "Bali.com", url: "https://bali.com", group: `bali` },
	balitravelhub: {
		module: "./scrape-balitravelhub.ts",
		label: "Bali Travel Hub",
		url: "https://www.balitravelhub.com",
		group: `bali`,
	},
	cooleventasia: { module: "./scrape-cooleventasia.ts", label: "Cool Event Asia", url: "https://cooleventasia.com", group: `bali` },
	goers: { module: "./scrape-goers.ts", label: "GOERS", url: "https://www.goersapp.com", group: `bali` },
	nowbali: { module: "./scrape-nowbali.ts", label: "NOW! Bali", url: "https://www.nowbali.co.id", group: `bali` },
	seeevents: { module: "./scrape-seeevents.ts", label: "SEE Events Bali", url: "https://app.see.events", group: `bali` },
	yogabarn: {
		module: "./scrape-yogabarn.ts",
		label: "The Yoga Barn",
		url: "https://theyogabarn.com",
		retryOnNewIp: true,
		group: `bali`,
	},
	tantrakalender: { module: "./scrape-tantrakalender.ts", label: "Tantrakalender", url: "https://tantrakalender.de", group: `germany` },
	tantrazentrumleipzig: {
		module: "./scrape-tantrazentrumleipzig.ts",
		label: "Tantrazentrum Leipzig",
		url: "https://www.tantrazentrum-leipzig.de",
		group: `germany`,
	},
	consciousevents: {
		module: "./scrape-consciousevents.ts",
		label: "conscious events",
		url: "https://conscious-events.com",
		group: `germany`,
	},
	dieliebelle: { module: "./scrape-dieliebelle.ts", label: "DIE LIEBE.LLE", url: "https://www.die-liebelle.de", group: `germany` },
	createparty: { module: "./scrape-createparty.ts", label: "create.party", url: "https://create.party", group: `germany` },
	wimhofmethod: {
		module: "./scrape-wimhofmethod.ts",
		label: "Wim Hof Method",
		url: "https://activities.wimhofmethod.com",
		group: `global`,
	},
	meetup: { module: "./scrape-meetup.ts", label: "Meetup", url: "https://www.meetup.com", group: `global` },
	eventbrite: { module: "./scrape-eventbrite.ts", label: "Eventbrite", url: "https://www.eventbrite.com", group: `global` },
	humanitix: { module: "./scrape-humanitix.ts", label: "Humanitix", url: "https://humanitix.com", group: `global` },
	miteinandersein: {
		module: "./scrape-miteinandersein.ts",
		label: "MiteinanderSein",
		url: "https://www.miteinandersein.net",
		group: `germany`,
	},
	yogavidya: { module: "./scrape-yoga-vidya.ts", label: "Yoga Vidya", url: "https://www.yoga-vidya.de", group: `germany` },
	kayana: { module: "./scrape-kayana.ts", label: "Kayana", url: "https://dein-kayana.de", group: `germany` },
	soulcollective: {
		module: "./scrape-soulcollective.ts",
		label: "Soul Collective",
		url: "https://www.soulcollective.eu",
		group: `germany`,
	},
	fitra: { module: "./scrape-fitra.ts", label: "FITRA", url: "https://fitra.asia", group: `bali` },
	facebook: { module: "./scrape-facebook.ts", label: "Facebook Events", url: "https://www.facebook.com/events/", group: `global` },
	// lumaya: { module: './scrape-lumaya.ts' } wollen die mich verklagen?
} as const satisfies Record<
	string,
	{ module: string; label: string; url: string; group: ScraperSourceGroup; retryOnNewIp?: boolean }
>;

export const WEBSITE_SCRAPE_SOURCES = Object.keys(WEBSITE_SCRAPER_CONFIG) as (keyof typeof WEBSITE_SCRAPER_CONFIG)[];

export type WebsiteScrapeSourceName = (typeof WEBSITE_SCRAPE_SOURCES)[number];

export const WEBSITE_SCRAPE_SOURCE_URLS = Object.values(WEBSITE_SCRAPER_CONFIG).map((x) => x.url);

export function scraperSourceGroupFilterValue(group: ScraperSourceGroup) {
	return `${SCRAPER_SOURCE_GROUP_PREFIX}${group}`;
}

export function parseScraperSourceGroupFilter(value: string | null | undefined): ScraperSourceGroup | null {
	const trimmed = value?.trim();
	if (!trimmed?.startsWith(SCRAPER_SOURCE_GROUP_PREFIX)) return null;

	const group = trimmed.slice(SCRAPER_SOURCE_GROUP_PREFIX.length);
	if (!(group in SCRAPER_SOURCE_GROUPS)) return null;
	return group as ScraperSourceGroup;
}

export function getSourcesForScraperSourceGroup(group: ScraperSourceGroup) {
	return WEBSITE_SCRAPE_SOURCES.filter((source) => WEBSITE_SCRAPER_CONFIG[source].group === group);
}

/** Source groups that currently have at least one scraper, in display order. */
export function getPopulatedScraperSourceGroups() {
	const order = Object.keys(SCRAPER_SOURCE_GROUPS) as ScraperSourceGroup[];
	return order.filter((group) => getSourcesForScraperSourceGroup(group).length);
}

/**
 * Resolves an admin source filter cookie/param to concrete `events.source` values.
 * `null` / empty / `all` → no source restriction.
 * `group:bali` → all scrapers in that group.
 * Otherwise → single source key.
 */
export function resolveEventSourceFilter(value: string | null | undefined): string[] | null {
	const trimmed = value?.trim();
	if (!trimmed || trimmed === `all`) return null;

	const group = parseScraperSourceGroupFilter(trimmed);
	if (group) {
		const sources = getSourcesForScraperSourceGroup(group);
		return sources.length ? sources : null;
	}

	return [trimmed];
}

export function getEventSourceFilterLabel(value: string) {
	const group = parseScraperSourceGroupFilter(value);
	if (group) return SCRAPER_SOURCE_GROUPS[group].label;

	if (value in WEBSITE_SCRAPER_CONFIG) {
		return WEBSITE_SCRAPER_CONFIG[value as WebsiteScrapeSourceName].label;
	}

	return value;
}

/**
 * Builds admin filter select options: All, then sources under group headers
 * (display order), alphabetical by label within each group. Unknown sources
 * land under "Other".
 */
export function buildAdminEventSourceFilterOptions(sources: string[]) {
	const byGroup = new Map<ScraperSourceGroup | `other`, string[]>();

	for (const source of sources) {
		const group =
			source in WEBSITE_SCRAPER_CONFIG
				? WEBSITE_SCRAPER_CONFIG[source as WebsiteScrapeSourceName].group
				: (`other` as const);
		const list = byGroup.get(group) ?? [];
		list.push(source);
		byGroup.set(group, list);
	}

	for (const list of byGroup.values()) {
		list.sort((a, b) => getEventSourceFilterLabel(a).localeCompare(getEventSourceFilterLabel(b), `en`, { sensitivity: `base` }));
	}

	const options: { value: string; html: string; disabled?: boolean }[] = [{ value: `all`, html: `All` }];
	const groupOrder = [...(Object.keys(SCRAPER_SOURCE_GROUPS) as ScraperSourceGroup[]), `other` as const];

	for (const group of groupOrder) {
		const groupSources = byGroup.get(group);
		if (!groupSources?.length) continue;

		const label = group === `other` ? `Other` : SCRAPER_SOURCE_GROUPS[group].label;
		options.push({ value: `__section-${group}__`, html: `── ${label} ──`, disabled: true });
		for (const source of groupSources) {
			options.push({ value: source, html: getEventSourceFilterLabel(source) });
		}
	}

	return options;
}
