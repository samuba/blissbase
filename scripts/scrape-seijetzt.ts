/**
 * Fetches event pages from sei.jetzt (starting from https://sei.jetzt/)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from sei.jetzt:
 * - Iterates through pagination pages (currently configured for first page, but adaptable).
 * - Fetches each event's detail page after parsing from list pages.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 *
 * When a local HTML file path is provided:
 * - Parses only that single HTML file (expected to be an event detail page).
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prints the single event JSON to standard output.
 *
 * Requires Bun (https://bun.sh/) for running, primarily for 'Bun.file' in local mode.
 *
 * Usage:
 *   To scrape from the web: bun run scripts/scrape-seijetzt.ts > seijetzt-events.json
 *   To parse a local file:  bun run scripts/scrape-seijetzt.ts <path_to_html_file> > seijetzt-event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import * as cheerio from 'cheerio';
import {
    REQUEST_DELAY_MS,
    WebsiteScraperInterface,
    customFetch,
    germanDateToIsoStr,
    superTrim
} from "./common.ts";
import { sleep } from "bun";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

const BASE_URL = "https://sei.jetzt";
const START_PATH = "/"; // Main page seems to list events

export class WebsiteScraper implements WebsiteScraperInterface {
    private readonly baseUrl: string;
    private readonly startPath: string;
    private readonly requestDelayMs: number;

    constructor() {
        this.baseUrl = BASE_URL;
        this.startPath = START_PATH;
        this.requestDelayMs = REQUEST_DELAY_MS;
    }

    private _parseAddressLines(addressStr: string | undefined): string[] {
        if (!addressStr) return [];
        // console.error(`Parsing address HTML: ${addressStr.substring(0, 150)}...`);
        if (addressStr.includes('<div class=') || addressStr.includes('role="status"')) {
            return [];
        }
        addressStr = addressStr.replace(/<br\s*\/?>/gi, ',');
        const textContent = addressStr.replace(/<[^>]*>/g, '');
        const lines = textContent.split(',').map(part => part.trim()).filter(part =>
            part.length > 0 &&
            !part.toLowerCase().includes('karte anzeigen') &&
            !part.toLowerCase().includes('google map')
        );
        // console.error(`Address lines extracted: ${JSON.stringify(lines)}`);
        return lines;
    }

    private async extractEventUrls(html: string): Promise<string[]> {
        const $ = cheerio.load(html);
        const permalinks: string[] = [];
        const eventCards = $('div.fi-ta-record');

        eventCards.each((_index, element) => {
            const $card = $(element);
            const $link = $card.find('a[href^="https://sei.jetzt/event/"]').first();
            const permalink = $link.attr('href');

            if (permalink) {
                permalinks.push(permalink);
            }
        });

        return permalinks;
    }

    // ---- WebsiteScraper Interface Methods for Extracting Fields from Detail Page HTML ----

    extractName(html: string): string | undefined {
        const $ = cheerio.load(html);
        const nameSelectors = ['h1', 'h2.event-title', '.event-title', '.title', 'title'];
        for (const selector of nameSelectors) {
            const nameElement = $(selector).first();
            if (nameElement.length > 0) {
                const name = nameElement.text().trim();
                if (name && name.length > 0 && !name.toLowerCase().includes('sei.jetzt') && !name.toLowerCase().includes('veranstaltung')) {
                    return name;
                }
            }
        }
        // Fallback: Try to get from <title> tag more generically
        const titleTag = $('title').first().text().trim();
        if (titleTag && !titleTag.toLowerCase().includes('sei.jetzt') && !titleTag.toLowerCase().includes('veranstaltung')) {
            // Often titles have site name, try to remove it
            return titleTag.split('|')[0].trim();
        }
        return undefined;
    }

    extractStartAt(html: string) {
        const $ = cheerio.load(html);

        const dateElement = $('[x-data*="date"]')?.[0];
        if (!dateElement) throw new Error('No startAt elements found in HTML');

        return this._extractDateFromXDataElement($, dateElement);
    }

    extractEndAt(html: string) {
        const $ = cheerio.load(html);

        const dateElement = $('[x-data*="date"]')?.[1];
        if (!dateElement) return undefined;

        return this._extractDateFromXDataElement($, dateElement);
    }

    private _extractDateFromXDataElement($: cheerio.Root, dateElement: cheerio.Element) {
        const xDataAttr = $(dateElement).attr('x-data');
        if (!xDataAttr) throw new Error('No x-data attribute found in HTML');

        const dateMatch = xDataAttr.match(/new Date\((.*?)\)/);
        if (!dateMatch || !dateMatch[1]) throw new Error('No date match found in x-data attribute');

        const dateParams = dateMatch[1].split(',').map(param => param.trim());
        if (dateParams.length < 5) throw new Error('Invalid date parameters');

        const year = parseInt(dateParams[0]);
        const month = parseInt(dateParams[1]);
        const day = parseInt(dateParams[2]);
        const hour = parseInt(dateParams[3]);
        const minute = parseInt(dateParams[4]);

        return germanDateToIsoStr(year, month, day, hour, minute);
    }

    extractAddress(html: string): string[] | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        let addressLines: string[] | null = null;
        const addressFinders = [
            () => {
                const veranstaltungsortText = $('div:contains("Veranstaltungsort"), h3:contains("Veranstaltungsort"), h4:contains("Veranstaltungsort"), dt:contains("Veranstaltungsort"), strong:contains("Veranstaltungsort")');
                if (veranstaltungsortText.length > 0) {
                    for (let i = 0; i < veranstaltungsortText.length; i++) {
                        const element = $(veranstaltungsortText[i]);
                        if (element.text().trim() === 'Veranstaltungsort' || element.text().trim().includes('Veranstaltungsort')) {
                            const possibleContainers = [element.next(), element.parent(), element.parent().next()];
                            for (const container of possibleContainers) {
                                if (container.length > 0) {
                                    const html = container.html();
                                    if (html) { const lines = this._parseAddressLines(html); if (lines.length > 0) return lines; }
                                }
                            }
                        }
                    }
                } return null;
            },
            () => {
                const germanAddressRegex = /([A-Za-zäöüÄÖÜßs.-]+\s\d+,\s\d{5}\s[A-Za-zäöüÄÖÜßs.-]+)/g;
                const matches = $('body').text().match(germanAddressRegex);
                if (matches && matches.length > 0) return matches[0].split(',').map(part => part.trim());
                return null;
            },
            () => {
                const $dl = $('dl.fi-description-list, dl').first();
                if ($dl.length > 0) {
                    const ortDt = $dl.find('dt:contains("Ort")').first();
                    if (ortDt.length > 0) {
                        const html = ortDt.next('dd').html();
                        if (html) return this._parseAddressLines(html);
                    }
                } return null;
            },
            () => {
                const addressElements = $('[class*="address"], [class*="location"], [class*="venue"], [class*="ort"]');
                if (addressElements.length > 0) {
                    for (let i = 0; i < addressElements.length; i++) {
                        const text = $(addressElements[i]).text().trim();
                        if (text && text.length > 5 && /\d{5}/.test(text)) return text.split(',').map(part => part.trim());
                    }
                } return null;
            }
        ];
        for (const finder of addressFinders) { addressLines = finder(); if (addressLines && addressLines.length > 0) break; }
        return addressLines ?? undefined;
    }

    extractPrice(html: string): string | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        const priceElement = $('div.font-bold:contains("Preis")').first().parent();
        priceElement.find('svg').parent().remove();
        priceElement.find('*').removeAttr('class').removeAttr('style');

        const divs = priceElement.find('div')
        if (divs.length === 1) {
            return superTrim(divs.first().html());
        }

        return superTrim(priceElement.html());
    }

    extractDescription(html: string): string | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        const description = $('.prose').first().html();
        return description ?? undefined;
    }

    extractImageUrls(html: string): string[] | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        const imageUrlsSet = new Set<string>();
        $('.embla__container .rounded-xl > img').each((_i, img) => {
            const src = $(img).attr('src') || $(img).attr('data-src') || $(img).attr('data-lazy-src');
            if (src && !src.startsWith('data:') && !src.includes('placeholder') && src.length < 1200) {
                try {
                    imageUrlsSet.add(new URL(src, this.baseUrl).toString());
                } catch { /* ignore */ }
            }
        });

        return imageUrlsSet.size > 0 ? Array.from(imageUrlsSet) : undefined;
    }

    extractHost(html: string): string | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });

        // find element with href starting with https://sei.jetzt/o/ that contains text
        const hostLinkElement = $('a[href^="https://sei.jetzt/o/"]')
            .filter((_i, el) => $(el).text().trim().length > 0)
            .first();

        return hostLinkElement?.text()?.trim();
    }

    extractHostLink(html: string): string | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });

        // find element with href starting with https://sei.jetzt/o/ that contains text
        const hostLinkElement = $('a[href^="https://sei.jetzt/o/"]')
            .filter((_i, el) => $(el).text().trim().length > 0)
            .first();

        return hostLinkElement?.attr('href');
    }

    extractTags(html: string): string[] | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        const tagsSet = new Set<string>();
        const tagSelectors = [
            'dl.fi-description-list dt:contains("Kategorien") + dd span a',
            'dl.fi-description-list dt:contains("Tags") + dd span a',
            'dl.fi-description-list dt:contains("Schlagworte") + dd span a',
            '.tags a, .categories a, .event-tags a, .event-categories a, a.tag, span.tag, div.tag, .chip, .badge, .pill, .fi-badge',
            'div.flex.flex-grow-1.items-center.gap-2 > div'
        ];

        for (const selector of tagSelectors) {
            $(selector).each((_i, el) => {
                const $el = $(el);
                const tagText = $el.text().trim();
                // For the last selector, ensure it's a direct text node or simple structure
                if (selector.endsWith('> div') && $el.children().length > 0 && !$el.is('.fi-badge')) return;

                if (tagText && tagText.length > 0 && tagText.length < 100) {
                    tagsSet.add(tagText);
                }
            });
            if (tagsSet.size > 0 && selector !== tagSelectors[tagSelectors.length - 1]) break; // Early exit if specific selectors yield results
        }
        return tagsSet.size > 0 ? Array.from(tagsSet) : undefined;
    }

    // ---- Main Scraper Logic ----

    public async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
        const name = this.extractName(html);
        const startAt = this.extractStartAt(html);
        let endAt = this.extractEndAt(html);
        if (!name || !startAt) return undefined;

        if (endAt && startAt && (endAt < startAt)) {
            console.warn(`Event ${name} has endAt (${endAt}) before startAt (${startAt}). Setting endAt to undefined.`);
            endAt = undefined;
        }

        const coordinates = await geocodeAddressCached(this.extractAddress(html) || [], process.env.GOOGLE_MAPS_API_KEY || '');

        const price = this.extractPrice(html) ?? null;

        return {
            name,
            startAt,
            endAt,
            address: this.extractAddress(html) || [],
            price,
            priceIsHtml: price?.startsWith('<div>') ?? false,
            description: this.extractDescription(html) ?? null,
            imageUrls: this.extractImageUrls(html) || [],
            host: this.extractHost(html) ?? null,
            hostLink: this.extractHostLink(html) ?? null,
            sourceUrl: url,
            latitude: coordinates?.lat ?? null,
            longitude: coordinates?.lng ?? null,
            tags: this.extractTags(html) || [],
            source: 'seijetzt',
        };
    }

    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];
        let currentPage = 1;
        let keepFetching = true;

        console.error("--- Starting Sei.Jetzt Event Scraper (Web Mode) ---");

        while (keepFetching) {
            const pageUrl = `${this.baseUrl}${this.startPath}?page=${currentPage}`;
            console.error(`\n--- Fetching Page ${currentPage}: ${pageUrl} ---`);

            await sleep(this.requestDelayMs);
            const pageHtml = await customFetch(pageUrl);
            if (!pageHtml) {
                console.error(`Failed to fetch page ${currentPage}. Stopping.`);
                keepFetching = false;
                break;
            }

            try {
                const eventUrls = await this.extractEventUrls(pageHtml);
                if (eventUrls.length === 0) {
                    console.error(`Stopped fetching: No events found on page ${currentPage}.`);
                    keepFetching = false;
                    break;
                }

                console.error(` Processing ${eventUrls.length} events from page ${currentPage}...`);
                for (const eventUrl of eventUrls) {
                    try {
                        await sleep(this.requestDelayMs);
                        const html = await customFetch(eventUrl);

                        if (!html) {
                            console.error(`Failed to fetch details for: ${eventUrl}. Skipping event.`);
                            continue;
                        }

                        const event = await this.extractEventData(html, eventUrl);
                        console.error(event);
                        if (event) {
                            allEvents.push(event);
                        } else {
                            console.warn(`Failed to get complete details for event: ${eventUrl}`);
                        }
                    } catch (error) {
                        console.error(`Error processing event item "${eventUrl}":`, error);
                    }
                }
            } catch (error) {
                console.error(`Error processing page ${currentPage}:`, error);
            }

            currentPage++;
        }
        console.error(`\n--- Scraping finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }

    async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
        console.error(`--- Starting Sei.Jetzt Event Scraper (Local File Mode) ---`);
        const allEvents: ScrapedEvent[] = [];

        for (const filePath of filePaths) {
            console.error(`Processing local HTML file: ${filePath}...`);
            try {
                const htmlContent = await Bun.file(filePath).text();
                const event = await this.extractEventData(htmlContent, filePath); // Use permalink as file path
                if (event) {
                    if (!event.name || !event.startAt) {
                        console.warn(`Extracted event from ${filePath} is missing name or startAt. Outputting anyway.`);
                    }
                    allEvents.push(event);
                } else {
                    console.error(`Could not extract event data from ${filePath}.`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`Error processing file ${filePath}:`, message);
                if (message.includes("ENOENT")) {
                    console.error(`Hint: Make sure the file path "${filePath}" is correct and the file exists.`);
                }
            }
        }
        console.error(`--- Processed ${filePaths.length} files. Total events extracted: ${allEvents.length} ---`);
        return allEvents;
    }
}

if (import.meta.main) {
    const scraper = new WebsiteScraper();
    if (process.argv.length > 2) {
        console.log(await scraper.scrapeHtmlFiles(process.argv.slice(2)))
    } else {
        console.log(await scraper.scrapeWebsite())
    }
}

