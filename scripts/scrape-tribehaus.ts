/**
 * Fetches event pages from tribehaus.org (starting from https://tribehaus.org/events)
 * iterates through all pagination pages, and extracts all events as JSON according to the ScrapedEvent interface.
 * 
 * Requires Bun (https://bun.sh/).
 *
 * Usage:
 *   To scrape from the web: bun run scripts/scrape-tribehaus.ts > events.json
 *   To parse a local files:  bun run scripts/scrape-tribehaus.ts <path_to_html_file> <path_to_html_file> > event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts"; // Import shared interface
import * as cheerio from 'cheerio';
import {
    customFetch,
    parseGermanDateTime,
    REQUEST_DELAY_MS,
    WebsiteScraperInterface,
    makeAbsoluteUrl as commonMakeAbsoluteUrl,
    superTrim,
    cleanProseHtml
} from "./common.ts";

const BASE_URL = 'https://tribehaus.org';

// Helper function to make URLs absolute, specific to this scraper if needed, or use common.
function makeAbsoluteUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    return commonMakeAbsoluteUrl(url, BASE_URL);
}

export class WebsiteScraper implements WebsiteScraperInterface {
    // Parses a listing page to get event permalinks and the next page URL
    private parseEventList(html: string): { permalinks: string[], nextPageUrl: string | null } {
        const $ = cheerio.load(html);
        const permalinks: string[] = [];
        let potentialNextPageUrl: string | null = null;

        // Extract permalinks from the search result items
        $('.jq-result-list-item').each((_index, element) => {
            const link = $(element).find('.jq-link-entry-page').attr('href');
            if (link) {
                const absoluteLink = makeAbsoluteUrl(link);
                if (absoluteLink) {
                    permalinks.push(absoluteLink);
                }
            }
        });

        // Find next page link
        const nextPageLink = $('.page-next > a').attr('href');
        if (nextPageLink && nextPageLink !== '#') {
            potentialNextPageUrl = nextPageLink;
        }

        const rawNextPageUrl = potentialNextPageUrl ? makeAbsoluteUrl(potentialNextPageUrl) : null;
        const nextPageUrl = rawNextPageUrl === undefined ? null : rawNextPageUrl;

        return { permalinks, nextPageUrl };
    }

    extractName(html: string): string | undefined {
        const $ = cheerio.load(html);
        const name = superTrim($('h1').first().text());
        return name || undefined;
    }

    extractStartAt(html: string) {
        const $ = cheerio.load(html);
        const dateElement = $('.ep3001112').first();
        const timeElement = $('.ep3001113 span').first();
        if (!dateElement.length) throw new Error('No date element found');

        const dateStr = dateElement.text().trim();
        const timeStr = timeElement.length ? timeElement.text().trim() : undefined;

        // Check for range format "11.05.2025 bis 14.12.2025"
        const dateRangeMatch = dateStr.match(/(\d{2}\.\d{2}\.\d{4})\s*bis\s*(\d{2}\.\d{2}\.\d{4})/);
        if (dateRangeMatch) {
            // Use the start date of the range
            return parseGermanDateTime(dateRangeMatch[1], timeStr);
        }

        return parseGermanDateTime(dateStr, timeStr);
    }

    extractEndAt(html: string) {
        const $ = cheerio.load(html);
        const dateElement = $('.ep3001112').first();
        const timeElement = $('.ep3001113 span').first();
        if (!dateElement.length) throw new Error('No date element found');

        const dateStr = dateElement.text().trim();
        const timeStr = timeElement.length ? timeElement.text().trim() : undefined;

        // Check for range format "11.05.2025 bis 14.12.2025"
        const dateRangeMatch = dateStr.match(/(\d{2}\.\d{2}\.\d{4})\s*bis\s*(\d{2}\.\d{2}\.\d{4})/);
        if (dateRangeMatch) {
            // Use the end date of the range
            return parseGermanDateTime(dateRangeMatch[2], timeStr);
        }

        // Check for end time in range format "13:00 - 17:00" on the *same* day
        const timeRangeMatch = timeStr?.match(/\d{2}:\d{2}\s*-\s*(\d{2}:\d{2})/);
        if (timeRangeMatch) {
            return parseGermanDateTime(dateStr, timeRangeMatch[1]);
        }

        return parseGermanDateTime(dateStr, timeStr);
    }

    extractAddress(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const addressParts: string[] = [];
        $('.epl33 li').each((_, li) => {
            const strongText = $(li).find('strong').text().trim();
            const spanText = $(li).find('span:not([data-spec])').text().trim();
            const linkText = $(li).find('a').text().trim();
            const textToAdd = spanText || linkText;
            if (textToAdd && strongText !== 'Postleitzahl:') {
                addressParts.push(textToAdd);
            }
            if (strongText === 'Postleitzahl:' && linkText) {
                addressParts.push(linkText.replace('PLZ ', ''));
            }
        });
        const plzLink = $('.epl33 li:contains("Postleitzahl:") a').text().trim().replace('PLZ ', '');
        if (plzLink && !addressParts.some(p => p === plzLink)) {
            addressParts.push(plzLink);
        }
        return addressParts.filter(part => part && part.trim() !== '');
    }

    extractPrice(html: string): string | undefined {
        const $ = cheerio.load(html);
        const priceElement = $('li[data-property="Preis"] span').first();
        if (priceElement.length) {
            return priceElement.text().trim();
        }
        // Fallback: Check JSON-LD priceRange
        const jsonLdScript = $('script[type="application/ld+json"]').html();
        if (jsonLdScript) {
            try {
                const jsonData = JSON.parse(jsonLdScript);
                if (jsonData.priceRange) {
                    return jsonData.priceRange;
                }
                // Check offers
                if (jsonData.offers && jsonData.offers.price) {
                    return jsonData.offers.price + (jsonData.offers.priceCurrency ? " " + jsonData.offers.priceCurrency : "");
                }
                if (Array.isArray(jsonData.offers) && jsonData.offers[0] && jsonData.offers[0].price) {
                    return jsonData.offers[0].price + (jsonData.offers[0].priceCurrency ? " " + jsonData.offers[0].priceCurrency : "");
                }

            } catch (error) { void error; }
        }
        return undefined;
    }

    extractDescription(html: string): string | undefined {
        const $ = cheerio.load(html);
        const description = $('#description blockquote.readmore').html()?.trim();
        return cleanProseHtml(description);
    }

    extractImageUrls(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const imageUrls: string[] = [];
        $('.cb-slider-inner .item img').each((_, img) => {
            const src = $(img).attr('src') || $(img).attr('srcset')?.split(' ')[0];
            if (src) {
                const fullUrl = makeAbsoluteUrl(src)?.split('?')[0];
                if (fullUrl && !imageUrls.includes(fullUrl)) {
                    imageUrls.push(fullUrl);
                }
            }
        });
        $('.eph521:not(.eph521--map):not(.eph521--ratings) img').each((_, img) => {
            const src = $(img).attr('src') || $(img).attr('srcset')?.split(' ')[0];
            if (src) {
                const fullUrl = makeAbsoluteUrl(src)?.split('?')[0];
                if (fullUrl && !imageUrls.includes(fullUrl)) {
                    imageUrls.push(fullUrl);
                }
            }
        });
        return imageUrls.length > 0 ? imageUrls : undefined;
    }

    extractHost(html: string): string | undefined {
        const $ = cheerio.load(html);
        const memberLinkElement = $('li[data-property="Veranstalter"] a.jq-link-entry-page');
        if (memberLinkElement.length) {
            return memberLinkElement.text().trim();
        }
        const artistElement = $('li[data-property="Knstlername"] span').first();
        if (artistElement.length) {
            return artistElement.text().trim();
        }
        return undefined;
    }

    extractHostLink(html: string): string | undefined {
        const $ = cheerio.load(html);
        const memberLinkElement = $('li[data-property="Veranstalter"] a.jq-link-entry-page');
        let link = memberLinkElement.attr('href');

        if (!link) link = $('a.jq-link-to-website').attr('href');

        if (!link) return undefined;

        return makeAbsoluteUrl(link);
    }

    extractTags(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const tagsSet = new Set<string>();
        $('li[data-property="Rubrik"] div.available').each((_, div) => {
            const tagText = $(div).text().trim();
            if (tagText) {
                tagsSet.add(tagText);
            }
        });
        return tagsSet.size > 0 ? Array.from(tagsSet) : undefined;
    }

    extractCoordinates(html: string): { latitude: number | null, longitude: number | null } {
        const $ = cheerio.load(html);
        const jsonLdScript = $('script[type="application/ld+json"]').html();
        let latitude: number | null = null;
        let longitude: number | null = null;

        if (jsonLdScript) {
            try {
                const jsonData = JSON.parse(jsonLdScript);

                // Check direct geo property
                if (jsonData.geo) {
                    if (jsonData.geo.latitude) {
                        const lat = parseFloat(jsonData.geo.latitude);
                        latitude = !isNaN(lat) ? lat : null;
                    }
                    if (jsonData.geo.longitude) {
                        const lng = parseFloat(jsonData.geo.longitude);
                        longitude = !isNaN(lng) ? lng : null;
                    }
                }

                // Check location.geo property if direct geo wasn't found
                if ((!latitude || !longitude) && jsonData.location && jsonData.location.geo) {
                    if (!latitude && jsonData.location.geo.latitude) {
                        const lat = parseFloat(jsonData.location.geo.latitude);
                        latitude = !isNaN(lat) ? lat : null;
                    }
                    if (!longitude && jsonData.location.geo.longitude) {
                        const lng = parseFloat(jsonData.location.geo.longitude);
                        longitude = !isNaN(lng) ? lng : null;
                    }
                }
            } catch (error) { void error; }
        }

        return { latitude, longitude };
    }


    async extractEventData(html: string, permalink: string): Promise<ScrapedEvent | undefined> {
        const name = this.extractName(html);
        if (!name) {
            console.error(`Skipping event from ${permalink} due to missing name.`);
            return undefined;
        }

        const startAt = this.extractStartAt(html);
        if (!startAt) {
            console.error(`Invalid start date found for ${permalink} (name: ${name}). Skipping event.`);
            return undefined;
        }

        const { latitude, longitude } = this.extractCoordinates(html);

        return {
            name,
            startAt,
            endAt: this.extractEndAt(html),
            address: this.extractAddress(html) || [],
            price: this.extractPrice(html),
            priceIsHtml: false,
            description: this.extractDescription(html) || '',
            imageUrls: this.extractImageUrls(html) || [],
            host: this.extractHost(html),
            hostLink: this.extractHostLink(html),
            sourceUrl: permalink,
            latitude,
            longitude,
            tags: this.extractTags(html) || [],
            source: 'tribehaus',
        };
    }


    async scrapeWebsite(startUrl: string = `${BASE_URL}/events`): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];
        let allPermalinks: string[] = [];
        let currentListUrl: string | null = startUrl;
        let pageCount = 1;

        console.error("--- Starting Phase 1: Collecting Permalinks ---");
        while (currentListUrl) {
            try {
                const listHtml = await customFetch(currentListUrl);
                const { permalinks, nextPageUrl } = this.parseEventList(listHtml);

                if (permalinks.length === 0 && pageCount > 1) {
                    console.error(`No permalinks found on list page ${pageCount} (${currentListUrl}), stopping list pagination.`);
                    currentListUrl = null;
                } else if (permalinks.length === 0 && pageCount === 1) {
                    console.error(`No permalinks found on the first list page (${currentListUrl}), stopping.`);
                    currentListUrl = null;
                }
                else {
                    allPermalinks = allPermalinks.concat(permalinks);
                    currentListUrl = nextPageUrl;
                    pageCount++;
                    await Bun.sleep(REQUEST_DELAY_MS);
                }
            } catch (error) {
                console.error(`Error processing list page ${currentListUrl}:`, error);
                currentListUrl = null;
            }
        }
        console.error(`--- Finished Phase 1: Collected ${allPermalinks.length} permalinks ---`);

        console.error("--- Starting Phase 2: Fetching Event Details ---");
        let detailCount = 0;
        for (const permalink of allPermalinks) {
            detailCount++;
            console.error(`Fetching detail ${detailCount}/${allPermalinks.length}: ${permalink}...`);
            try {
                const eventHtml = await customFetch(permalink);
                const eventDetail = await this.extractEventData(eventHtml, permalink);
                console.error(eventDetail);
                if (eventDetail) {
                    allEvents.push(eventDetail);
                }
            } catch (error) {
                console.error(`Failed to process event detail ${permalink}:`, error);
            }
            await Bun.sleep(REQUEST_DELAY_MS);
        }
        console.error(`--- Finished Phase 2: Successfully parsed ${allEvents.length} events ---`);
        return allEvents;
    }

    async scrapeHtmlFiles(filePaths: string[]): Promise<ScrapedEvent[]> {
        console.error(`Processing ${filePaths.length} HTML file(s)...`);
        const allEvents: ScrapedEvent[] = [];

        for (const filePath of filePaths) {
            console.error(`Processing HTML file: ${filePath}...`);
            try {
                const htmlContent = await Bun.file(filePath).text();
                const event = await this.extractEventData(htmlContent, `file://${filePath}`);
                if (event) {
                    allEvents.push(event);
                }
            } catch (error) {
                console.error(`Error processing file ${filePath}:`, error);
            }
        }
        console.error(`--- File processing finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }
}


// Main execution
if (import.meta.main) {
    try {
        const scraper = new WebsiteScraper();
        if (process.argv.length > 2) {
            console.log(await scraper.scrapeHtmlFiles(process.argv.slice(2)))
        } else {
            console.log(await scraper.scrapeWebsite())
        }
    } catch (error) {
        console.error("Unhandled error in main execution:", error);
        process.exit(1);
    }
}
