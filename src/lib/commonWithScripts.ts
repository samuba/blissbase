export const WEBSITE_SCRAPER_CONFIG = {
    awara: { module: './scrape-awara.ts', label: 'Awara' },
    tribehaus: { module: './scrape-tribehaus.ts', label: 'Tribehaus' },
    heilnetz: { module: './scrape-heilnetz.ts', label: 'Heilnetz' },
    heilnetzowl: { module: './scrape-heilnetzowl.ts', label: 'Heilnetz OWL' },
    seijetzt: { module: './scrape-seijetzt.ts', label: 'Sei.Jetzt' },
    ggbrandenburg: { module: './scrape-ggbrandenburg.ts', label: 'Ganzheitlich Gesund Brandenburg' },
    kuschelraum: { module: './scrape-kuschelraum.ts', label: 'Kuschelraum' },
    ciglobalcalendar: { module: './scrape-ciglobalcalendar.ts', label: 'CI Globalcalendar' },
    todotoday: { module: './scrape-todotoday.ts', label: 'Todo.Today' },
    vortexapp: { module: './scrape-vortexapp.ts', label: 'Vortexapp' },
    megatix_indonesia: { module: './scrape-megatix_indonesia.ts', label: 'Megatix Indonesia' },
    // lumaya: { module: './scrape-lumaya.ts' } wollen die mich verklagen?
} as const;

export const WEBSITE_SCRAPE_SOURCES = Object.keys(WEBSITE_SCRAPER_CONFIG) as (keyof typeof WEBSITE_SCRAPER_CONFIG)[];

export type WebsiteScrapeSourceName = (typeof WEBSITE_SCRAPE_SOURCES)[number];