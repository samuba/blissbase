export const WEBSITE_SCRAPER_CONFIG = {
    awara: { module: './scrape-awara.ts', label: 'Awara', url: 'https://awara.events' },
    tribehaus: { module: './scrape-tribehaus.ts', label: 'Tribehaus', url: 'https://tribehaus.org' },
    heilnetz: { module: './scrape-heilnetz.ts', label: 'Heilnetz', url: 'https://heilnetz.de' },
    heilnetzowl: { module: './scrape-heilnetzowl.ts', label: 'Heilnetz OWL', url: 'https://www.heilnetz-owl.de' },
    seijetzt: { module: './scrape-seijetzt.ts', label: 'Sei.Jetzt', url: 'https://sei.jetzt' },
    ggbrandenburg: { module: './scrape-ggbrandenburg.ts', label: 'Ganzheitlich Gesund Brandenburg', url: 'https://www.ganzheitlich-gesund-brandenburg.de' },
    kuschelraum: { module: './scrape-kuschelraum.ts', label: 'Kuschelraum', url: 'https://kuschelraum.de' },
    ciglobalcalendar: { module: './scrape-ciglobalcalendar.ts', label: 'CI Globalcalendar', url: 'https://ciglobalcalendar.net' },
    todotoday: { module: './scrape-todotoday.ts', label: 'Todo.Today', url: 'https://todo.today' },
    vortexapp: { module: './scrape-vortexapp.ts', label: 'Vortexapp', url: 'https://vortexapp.dev' },
    megatix_indonesia: { module: './scrape-megatix_indonesia.ts', label: 'Megatix Indonesia', url: 'https://megatix.co.id' },
    whatsupdanang: { module: './scrape-whatsupdanang.ts', label: 'WhatsUpDaNang', url: 'https://whatsupdanang.com' },
    // lumaya: { module: './scrape-lumaya.ts' } wollen die mich verklagen?
} as const satisfies Record<string, { module: string, label: string, url: string }>;

export const WEBSITE_SCRAPE_SOURCES = Object.keys(WEBSITE_SCRAPER_CONFIG) as (keyof typeof WEBSITE_SCRAPER_CONFIG)[];

export type WebsiteScrapeSourceName = (typeof WEBSITE_SCRAPE_SOURCES)[number];

export const WEBSITE_SCRAPE_SOURCE_URLS = Object.values(WEBSITE_SCRAPER_CONFIG).map(x => x.url);