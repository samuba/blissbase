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
    REQUEST_DELAY_MS,
    WebsiteScraperInterface,
    makeAbsoluteUrl as commonMakeAbsoluteUrl,
    superTrim,
    cleanProseHtml,
    germanDateToIsoStr
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

const BASE_URL = 'https://ciglobalcalendar.net';

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

        $('.eventList a').each((_index, element) => {
            const link = $(element).attr('href');
            if (link && link.startsWith('/event/')) {
                const absoluteLink = makeAbsoluteUrl(link);
                if (absoluteLink) {
                    permalinks.push(absoluteLink);
                }
            }
        });

        return { permalinks, nextPageUrl: $('.page-link[rel="next"]').attr('href') || null };
    }

    extractName(html: string): string | undefined {
        const $ = cheerio.load(html);
        const name = superTrim($('.event-title').first().text());
        if (name?.toLowerCase()?.includes('contact') || name?.toLowerCase()?.includes('improv') || name?.includes('CI')) {
            return name
        } else {
            return 'Contact Improvisation ' + name
        }
    }

    getDateIsoStr(datePart: string, startTimePart: string): string | undefined {
        // example: "11 Dec 2023 @ 11.00 am   1.00 pm"
        const dateMatch = datePart.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
        if (!dateMatch) return undefined;

        const day = parseInt(dateMatch[1]);
        const monthName = dateMatch[2];
        const year = parseInt(dateMatch[3]);

        // Convert month name to number (0-indexed)
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const month = monthNames.findIndex(m => monthName.startsWith(m));
        if (month === -1) return undefined;

        // Parse time "11.00 am"
        const timeMatch = startTimePart.match(/(\d{1,2})\.(\d{2})\s*(am|pm)/i);
        if (!timeMatch) return undefined;

        let hour = parseInt(timeMatch[1]);
        const minute = parseInt(timeMatch[2]);
        const ampm = timeMatch[3].toLowerCase();

        // Convert to 24-hour format
        if (ampm === 'pm' && hour !== 12) {
            hour += 12;
        } else if (ampm === 'am' && hour === 12) {
            hour = 0;
        }

        return germanDateToIsoStr(year, month, day, hour, minute);
    }

    extractDates(html: string): { startAt: string | undefined, endAt: string | undefined } {
        const $ = cheerio.load(html);

        const dateStr = $(".smalldate").first().text();
        if (!dateStr) return { startAt: undefined, endAt: undefined };

        if (dateStr.indexOf('@') === dateStr.lastIndexOf('@')) {
            // single day event: "11 Dec 2023 @ 11.00 am   1.00 pm"
            const datePart = dateStr.split('@')[0].trim();
            const timePart = dateStr.split('@')[1].trim();

            if (timePart.includes('   ')) {
                // has end time
                const startAt = this.getDateIsoStr(datePart, timePart.split('   ')[0].trim());
                const endAt = this.getDateIsoStr(datePart, timePart.split('   ')[1].trim());
                return { startAt, endAt };
            } else {
                // does not have end time
                const startAt = this.getDateIsoStr(datePart, timePart);
                return { startAt, endAt: undefined };
            }

        } else {
            // // multi day event: "4 Sep 2025 @ 12.00 am  7 Sep 2025 @  12.00 am"
            dateStr.indexOf('  ')
            const startPart = dateStr.substring(0, dateStr.indexOf('  ')).trim()
            const endPart = dateStr.replace(startPart, '').trim()
            const startAt = this.getDateIsoStr(startPart.split('@')[0].trim(), startPart.split('@')[1].trim());
            const endAt = this.getDateIsoStr(endPart.split('@')[0].trim(), endPart.split('@')[1].trim());
            return { startAt, endAt };
        }
    }

    extractStartAt(html: string) {
        // handled in extractDates
        return undefined
    }

    extractEndAt(html: string) {
        // handled in extractDates
        return undefined
    }

    extractAddress(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const mapBtnText = $('.venue a').first().text().trim()
        const venueText = $('.venue').first().text().replace(mapBtnText, '').replace('Germany', 'DE')
        return venueText.split(',').map(part => {
            const x = superTrim(part)!
            return x?.endsWith('-') ? x.slice(0, -1).trim() : x
        }).filter(x => x?.trim())
    }

    extractPrice(html: string): string | undefined {
        return undefined;
    }

    extractDescription(html: string): string | undefined {
        const $ = cheerio.load(html);
        const description = $('.text-base-longtext').first().clone().find('img').remove().end().html()?.trim();
        return cleanProseHtml(description);
    }

    extractImageUrls(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const imageUrls: string[] = [];
        $(".text-base-longtext img").each((_, img) => {
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
        const hosts: string[] = [];
        $('.event-wrapper a').each((_, a) => {
            const href = $(a).attr('href');
            if (href && href.startsWith('/teacher')) {
                hosts.push($(a).text().trim());
            }
        });
        return hosts.length > 0 ? hosts.join(', ') : undefined;
    }

    extractHostLink(html: string): string | undefined {
        const $ = cheerio.load(html);
        const firstHostLink = $('.event-wrapper a').filter((_, a) => {
            const href = $(a).attr('href');
            return !!(href && href.startsWith('/teacher'));
        }).first().attr('href');

        return firstHostLink ? makeAbsoluteUrl(firstHostLink) : undefined;
    }

    extractTags(html: string): string[] | undefined {
        const $ = cheerio.load(html);
        const tagsSet = new Set<string>();
        tagsSet.add('Contact Improvisation')

        const category = $('.event-wrapper [data-toggle="tooltip"][title="Category"]').first().parent()
        if (category) tagsSet.add(category.text().trim());

        return tagsSet.size > 0 ? Array.from(tagsSet) : undefined;
    }


    extractSourceUrl(html: string, permalink: string): string {
        const $ = cheerio.load(html);
        const sourceUrls: string[] = [];
        $('.event-wrapper a').each((_, a) => {
            const href = $(a).attr('href');
            if (href && !href.startsWith('/') && !href.startsWith('#')) {
                sourceUrls.push(href)
            }
        });
        return sourceUrls.length ? sourceUrls[sourceUrls.length - 1] : permalink
    }

    async extractEventData(html: string, permalink: string): Promise<ScrapedEvent | undefined> {
        const name = this.extractName(html);
        if (!name) {
            console.error(`Skipping event from ${permalink} due to missing name.`);
            return undefined;
        }


        const { startAt, endAt } = this.extractDates(html);
        if (!startAt) {
            console.error(`Invalid start date found for ${permalink} (name: ${name}). Skipping event.`);
            return undefined;
        }

        const address = this.extractAddress(html) || []
        const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');


        return {
            name,
            startAt,
            endAt,
            address,
            price: this.extractPrice(html),
            priceIsHtml: false,
            description: this.extractDescription(html) || '',
            imageUrls: this.extractImageUrls(html) || [],
            host: this.extractHost(html),
            hostLink: this.extractHostLink(html),
            sourceUrl: this.extractSourceUrl(html, permalink),
            latitude: coordinates?.lat ?? null,
            longitude: coordinates?.lng ?? null,
            tags: this.extractTags(html) || [],
            source: 'ciglobalcalendar',
        };
    }


    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];
        let allPermalinks: string[] = [];

        console.log('--- fetching permalinks ---')
        const firstPageHtml = await customFetch(`${BASE_URL}/de/eventSearch?country_id=186`, { returnType: 'text' })
        const firstPage = this.parseEventList(firstPageHtml);
        allPermalinks = allPermalinks.concat(firstPage.permalinks);
        let nextPageUrl = firstPage.nextPageUrl;
        while (nextPageUrl) {
            const pageHtml = await customFetch(nextPageUrl!, { returnType: 'text' });
            const currentPage = this.parseEventList(pageHtml);
            allPermalinks = allPermalinks.concat(currentPage.permalinks);
            nextPageUrl = currentPage.nextPageUrl;
        }
        console.log(`found ${allPermalinks.length} permalinks`)

        console.log('--- fetching event details ---')
        for (const url of allPermalinks) {
            console.log(`fetching event detail ${url}...`)
            const eventHtml = await customFetch(url, { returnType: 'text' });
            const event = await this.extractEventData(eventHtml, url);
            console.log(event)
            if (event) allEvents.push(event);
            await Bun.sleep(REQUEST_DELAY_MS);
        }

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
