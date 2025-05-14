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
    parseGermanDate as commonParseGermanDateString, // Renamed to avoid conflict
    REQUEST_DELAY_MS,
    geocodeAddressFromEvent,
    WebsiteScraper, // Import WebsiteScraper
    fetchWithTimeout
} from "./common.ts";
import { sleep } from "bun";

const BASE_URL = "https://sei.jetzt";
const START_PATH = "/"; // Main page seems to list events

export class SeijetztScraper implements WebsiteScraper {
    private readonly baseUrl: string;
    private readonly startPath: string;
    private readonly requestDelayMs: number;

    constructor() {
        this.baseUrl = BASE_URL;
        this.startPath = START_PATH;
        this.requestDelayMs = REQUEST_DELAY_MS;
    }

    private _parseGermanDateStringToDate(dateStr: string | undefined | null): Date | null {
        if (!dateStr) return null;
        const isoStr = commonParseGermanDateString(dateStr);
        if (!isoStr) return null;
        const dateObj = new Date(isoStr);
        return !isNaN(dateObj.getTime()) ? dateObj : null;
    }

    private _parseSeiJetztDateTimeObjectsFromListPage(startStr: string, endStrRaw: string | null): { startAt: Date | null, endAt: Date | null } {
        const startAt = this._parseGermanDateStringToDate(startStr);
        let endAt: Date | null = null;

        if (endStrRaw && endStrRaw.startsWith('- ')) {
            const endStr = endStrRaw.substring(2).trim();
            if (startAt && /^\d{1,2}:\d{2}$/.test(endStr)) {
                const startAtISO = commonParseGermanDateString(startStr); // Get ISO string again for manipulation
                const startDatePart = startAtISO?.split('T')[0];
                if (startDatePart) {
                    const [year, month, day] = startDatePart.split('-');
                    const endDateForParse = `${day}.${month}.${year} ${endStr}`;
                    endAt = this._parseGermanDateStringToDate(endDateForParse);
                }
            } else {
                endAt = this._parseGermanDateStringToDate(endStr);
            }
        }
        return { startAt, endAt };
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

    private async _parseListPage(html: string): Promise<Partial<ScrapedEvent>[]> {
        const $ = cheerio.load(html);
        const events: Partial<ScrapedEvent>[] = [];
        const eventCards = $('div.fi-ta-record');
        // console.error(`Found ${eventCards.length} event cards on the page.`);

        eventCards.each((_index, element) => {
            const $card = $(element);
            const $link = $card.find('a[href^="https://sei.jetzt/event/"]').first();

            const permalink = $link.attr('href');
            const name = $link.find('span.text-lg.font-bold').first().text().trim();

            const dateTimeSpans = $link.find('span.text-base.font-bold');
            const startStr = dateTimeSpans.eq(0).text().trim();
            const endStrRaw = dateTimeSpans.length > 1 ? dateTimeSpans.eq(1).text().trim() : null;

            const host = $link.find('span.text-lg.font-bold').closest('.fi-ta-col-wrp').next().find('span.text-sm').first().text().trim();

            let locationName: string | null = null;
            let address: string[] = [];
            const locationIcon = $link.find('svg path[d^="m11.54"]');
            if (locationIcon.length > 0) {
                const locationNameWrapper = locationIcon.closest('.fi-ta-col-wrp')?.next();
                if (locationNameWrapper) {
                    locationName = locationNameWrapper.find('span.text-sm').first().text().trim();
                    const tooltipWrapper = locationNameWrapper.find('.fi-ta-col-wrp[x-tooltip]');
                    const tooltipAttr = tooltipWrapper.attr('x-tooltip');
                    if (tooltipAttr) {
                        const match = tooltipAttr.match(/content:\s*'([^']*)'/);
                        if (match && match[1]) {
                            address = this._parseAddressLines(match[1]);
                        }
                    }
                    if (address.length === 0 && locationName) {
                        address = [locationName];
                    }
                }
            }

            if (!permalink || !name || !startStr) {
                // console.error("Skipping event card due to missing permalink, name, or start date string.");
                return;
            }

            const { startAt, endAt } = this._parseSeiJetztDateTimeObjectsFromListPage(startStr, endStrRaw);

            if (!startAt) {
                // console.error(`Skipping event "${name}" due to failed date parsing for start: "${startStr}"`);
                return;
            }

            const partialEvent: Partial<ScrapedEvent> = {
                permalink,
                name,
                startAt, // This is now Date | null
                endAt,   // This is now Date | null
                address,
                host,
                hostLink: null,
                price: null,
                description: null,
                latitude: null,
                longitude: null,
                tags: [],
            };
            events.push(partialEvent);
        });

        // console.error(`Parsed ${events.length} partial events from the list page.`);
        return events;
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

    private _extractDateTimeInfoFromDetailPage(html: string): { startAt?: Date, endAt?: Date } {
        const $ = cheerio.load(html, { decodeEntities: true });
        let dateString: string | null = null;

        const dateFinders = [
            () => {
                const $dl = $('dl.fi-description-list').first();
                if ($dl.length > 0) {
                    const dateDt = $dl.find('dt:contains("Datum")').first();
                    if (dateDt.length > 0) return dateDt.next('dd').text().trim();
                } return null;
            },
            () => {
                const datePatterns = [/(\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2})/g, /(\d{1,2}\.\d{1,2}\.\d{4})/g];
                for (const pattern of datePatterns) {
                    const matches = $('body').text().match(pattern);
                    if (matches && matches.length > 0) return matches[0];
                } return null;
            },
            () => {
                const dateElements = $('[class*="date"], [class*="time"], [class*="termin"], div:contains("Datum:"), div:contains("Termin:"), span:contains("Datum:")');
                if (dateElements.length > 0) {
                    for (let i = 0; i < dateElements.length; i++) {
                        const text = $(dateElements[i]).text().trim();
                        if (text.length > 5 && /\d{1,2}\.\d{1,2}\./.test(text)) return text;
                    }
                } return null;
            }
        ];
        for (const finder of dateFinders) { dateString = finder(); if (dateString) break; }

        if (!dateString) return {};

        let parsedStartAt: Date | null = null;
        let parsedEndAt: Date | null = null;

        const dateTimeRangeMatch = dateString.match(/(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)/);
        if (dateTimeRangeMatch) {
            parsedStartAt = this._parseGermanDateStringToDate(dateTimeRangeMatch[1].trim());
            parsedEndAt = this._parseGermanDateStringToDate(dateTimeRangeMatch[2].trim());
        } else {
            const startDateTimeMatch = dateString.match(/(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)/);
            if (startDateTimeMatch) {
                parsedStartAt = this._parseGermanDateStringToDate(startDateTimeMatch[1].trim());

                const endTimeOnlyMatch = dateString.match(/-\s*(\d{1,2}:\d{2})/);
                if (endTimeOnlyMatch && parsedStartAt) {
                    const startDateIso = parsedStartAt.toISOString().split('T')[0]; // YYYY-MM-DD
                    const [year, month, day] = startDateIso.split('-');
                    const endDateForParse = `${day}.${month}.${year} ${endTimeOnlyMatch[1].trim()}`;
                    parsedEndAt = this._parseGermanDateStringToDate(endDateForParse);
                }
            }
        }
        return { startAt: parsedStartAt ?? undefined, endAt: parsedEndAt ?? undefined };
    }

    extractStartAt(html: string): Date | undefined {
        return this._extractDateTimeInfoFromDetailPage(html).startAt;
    }

    extractEndAt(html: string): Date | undefined {
        return this._extractDateTimeInfoFromDetailPage(html).endAt;
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
        let priceContent: string | null = null;
        const pricePatterns = [
            () => {
                const $dl = $('dl.fi-description-list, dl').first();
                if ($dl.length > 0) {
                    const priceDt = $dl.find('dt:contains("Preis"), dt:contains("Kosten"), dt:contains("Preise")').first();
                    if (priceDt.length > 0) return priceDt.next('dd').html();
                } return null;
            },
            () => {
                const priceSection = $('.font-bold:contains("Preise")').closest('.col-span-2');
                if (priceSection.length > 0) {
                    const prices: string[] = [];
                    priceSection.find('> div').each((_i, div) => {
                        const priceText = $(div).text().trim();
                        if (priceText && priceText.includes('€') && !priceText.includes('Preise')) prices.push(priceText);
                    });
                    return prices.length > 0 ? prices.join('\n') : null;
                } return null;
            },
            () => {
                const priceHeaders = $('h3:contains("Preise"), h4:contains("Preise"), strong:contains("Preise"), div.font-bold:contains("Preise")');
                if (priceHeaders.length > 0) {
                    const priceHeader = $(priceHeaders[0]);
                    const prices: string[] = [];
                    priceHeader.parent().find('div').each((_i, el) => {
                        const text = $(el).text().trim();
                        if (text.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i) && !text.includes("Preise") && !text.includes("Google") && !text.includes("Karte")) prices.push(text);
                    });
                    if (prices.length > 0) return prices.join('\n');
                    return priceHeader.parent().html();
                } return null;
            },
            () => {
                const euroRegex = /(\d+([.,]\d+)?\s*€|\d+([.,]\d+)?\s*Euro)/i;
                const match = $('body').text().match(euroRegex);
                return match ? match[0] : null;
            }
        ];

        for (const finder of pricePatterns) { priceContent = finder(); if (priceContent) break; }

        if (priceContent) {
            if (typeof priceContent === 'string' && (priceContent.toLowerCase().includes("kostenlos") || priceContent.toLowerCase().includes("frei") || priceContent.toLowerCase().includes("gratis"))) {
                return "Free";
            } else if (typeof priceContent === 'string' && priceContent.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i)) {
                const $priceContainer = $('<div>').html(priceContent);
                const prices: string[] = [];
                $priceContainer.find('div').each((_i, el) => {
                    const text = $(el).text().trim();
                    if (text.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i) && !text.includes("Google") && !text.includes("Karte") && !text.includes("Preise")) {
                        prices.push(text.replace(/\(\(/g, '(').replace(/\)\)/g, ')'));
                    }
                });
                if (prices.length === 0) {
                    const text = $priceContainer.text().trim().replace(/\s+/g, ' ').replace(/\(\(/g, '(').replace(/\)\)/g, ')');
                    if (text.match(/\d+([.,]\d+)?\s*(€|EUR|Euro)/i)) prices.push(text);
                }
                return prices.length > 0 ? prices.join("\n") : $priceContainer.text().trim().replace(/\s+/g, ' ').replace(/\(\(/g, '(').replace(/\)\)/g, ')');
            } else if (typeof priceContent === 'string') {
                return priceContent.trim().replace(/\s+/g, ' ').replace(/\(\(/g, '(').replace(/\)\)/g, ')');
            }
        }
        return undefined;
    }

    extractDescription(html: string): string | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        let description: string | null = null;
        const potentialDescSelectors = ['.prose', '.entry-content', 'article', '.event-description', '.fi-section-content', '.description', '#description', 'div[class*="description"]', 'div[class*="content"]'];
        for (const selector of potentialDescSelectors) {
            const element = $(selector).first();
            if (element.length > 0 && element.closest('aside, .sidebar').length === 0) {
                const descriptionText = element.text().trim().replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');
                if (descriptionText && descriptionText.length > 50) { description = descriptionText; break; }
            }
        }
        if (!description) {
            $('p').each((_i, p) => {
                const text = $(p).text().trim().replace(/\s+/g, ' ').replace(/\u00A0/g, ' ');
                if (text.length > 100) { description = text; return false; }
            });
        }
        return description ?? undefined;
    }

    extractImageUrls(html: string): string[] | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        const imageUrlsSet = new Set<string>();
        const $firstEmblaCont = $('.embla__container').first();
        if ($firstEmblaCont.length > 0) {
            $firstEmblaCont.find('.embla__slide__img img').each((_i, img) => {
                const $img = $(img);
                const src = $img.attr('src') || $img.attr('data-src') || $img.attr('data-lazy-src');
                if (src && !src.startsWith('data:') && !src.includes('placeholder') && src.length < 1200) {
                    try {
                        imageUrlsSet.add(new URL(src, this.baseUrl).toString());
                    } catch { /* ignore */ }
                }
            });
        }

        return imageUrlsSet.size > 0 ? Array.from(imageUrlsSet) : undefined;
    }

    extractHost(html: string): string | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        const hostLinkElement = $('.flex.flex-row.gap-4.ml-2.z-30.relative.items-center.mb-4.justify-center a');
        if (hostLinkElement.length > 0) {
            const pageHostName = hostLinkElement.find('.text-md.lg\\:text-xl.font-bold').text().trim();
            if (pageHostName) return pageHostName;
        }
        // Fallback logic from original description check (simplified)
        const description = this.extractDescription(html);
        if (description) {
            const urlRegex = /https?:\/\/(?:www\.)?([^/\s]+\.[^/\s]+)(?:\/[^\s]*)?/g;
            const matches = [...description.matchAll(urlRegex)];
            if (matches.length > 0) {
                for (const match of matches) {
                    const url = match[0];
                    if (['facebook.com', 'youtube.com', 'instagram.com', 'twitter.com', 'google.com', 'sei.jetzt'].some(skip => url.includes(skip))) continue;
                    try {
                        const urlObj = new URL(url);
                        const domainParts = urlObj.hostname.replace(/^www\./, '').split('.');
                        if (domainParts.length >= 2) {
                            return domainParts[0].replace(/-/g, ' ').split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                        }
                    } catch { /* ignore */ }
                    break;
                }
            }
        }
        return undefined;
    }

    extractHostLink(html: string): string | undefined {
        const $ = cheerio.load(html, { decodeEntities: true });
        const hostLinkElement = $('.flex.flex-row.gap-4.ml-2.z-30.relative.items-center.mb-4.justify-center a');
        if (hostLinkElement.length > 0) {
            const pageHostUrl = hostLinkElement.attr('href');
            if (pageHostUrl) return pageHostUrl;
        }
        // Fallback logic from original description check (simplified)
        const description = this.extractDescription(html);
        if (description) {
            const urlRegex = /https?:\/\/(?:www\.)?([^/\s]+\.[^/\s]+)(?:\/[^\s]*)?/g;
            const matches = [...description.matchAll(urlRegex)];
            if (matches.length > 0) {
                for (const match of matches) {
                    const url = match[0];
                    if (['facebook.com', 'youtube.com', 'instagram.com', 'twitter.com', 'google.com', 'sei.jetzt'].some(skip => url.includes(skip))) continue;
                    return url; // Use the first good URL
                }
            }
        }
        return undefined;
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

        if (!name || !startAt) {
            // console.error(`Skipping event from ${url} (detail page) due to missing name or start date.`);
            return undefined;
        }

        const coordinates = await geocodeAddressFromEvent(this.extractAddress(html) || []);

        return {
            name,
            startAt,
            endAt: this.extractEndAt(html) ?? null,
            address: this.extractAddress(html) || [],
            price: this.extractPrice(html) ?? null,
            description: this.extractDescription(html) ?? null,
            imageUrls: this.extractImageUrls(html) || [],
            host: this.extractHost(html) ?? null,
            hostLink: this.extractHostLink(html) ?? null,
            permalink: url,
            latitude: coordinates?.lat ?? null,
            longitude: coordinates?.lng ?? null,
            tags: this.extractTags(html) || [],
        };
    }

    private async _processListItem(partialEventFromList: Partial<ScrapedEvent>): Promise<ScrapedEvent | null> {
        if (!partialEventFromList.permalink) {
            console.error("Cannot process event with missing permalink.");
            return null;
        }
        if (!partialEventFromList.name || !partialEventFromList.startAt) { // startAt is Date here
            console.error(`Skipping detail fetch for invalid partial event (name/startAt missing):`, partialEventFromList.permalink);
            return null;
        }

        await sleep(this.requestDelayMs);
        const html = await fetchWithTimeout(partialEventFromList.permalink);

        if (!html) {
            console.error(`Failed to fetch details for: ${partialEventFromList.permalink}. Using list data.`);
            const coordinates = partialEventFromList.address && partialEventFromList.address.length > 0 ? await geocodeAddressFromEvent(partialEventFromList.address) : null;
            return {
                name: partialEventFromList.name,
                startAt: partialEventFromList.startAt,
                endAt: partialEventFromList.endAt ?? null,
                address: partialEventFromList.address ?? [],
                price: partialEventFromList.price ?? null,
                description: partialEventFromList.description ?? 'Failed to fetch event details.',
                imageUrls: partialEventFromList.imageUrls ?? [],
                host: partialEventFromList.host ?? null,
                hostLink: partialEventFromList.hostLink ?? null,
                permalink: partialEventFromList.permalink,
                latitude: coordinates?.lat ?? null,
                longitude: coordinates?.lng ?? null,
                tags: partialEventFromList.tags ?? [],
            };
        }

        const detailPageEventData = await this.extractEventData(html, partialEventFromList.permalink);

        if (!detailPageEventData) {
            console.warn(`Failed to extract core data from detail page: ${partialEventFromList.permalink}. Using list data primarily.`);
            const coordinates = partialEventFromList.address && partialEventFromList.address.length > 0 ? await geocodeAddressFromEvent(partialEventFromList.address) : null;
            return {
                name: partialEventFromList.name,
                startAt: partialEventFromList.startAt,
                endAt: partialEventFromList.endAt ?? null,
                address: partialEventFromList.address ?? [],
                price: partialEventFromList.price ?? null,
                description: partialEventFromList.description ?? 'Detail page parsing failed.',
                imageUrls: partialEventFromList.imageUrls ?? [],
                host: partialEventFromList.host ?? null,
                hostLink: partialEventFromList.hostLink ?? null,
                permalink: partialEventFromList.permalink,
                latitude: coordinates?.lat ?? null,
                longitude: coordinates?.lng ?? null,
                tags: partialEventFromList.tags ?? [],
            };
        }

        // Merge strategy: Prioritize detail page, supplement with list page
        const finalEvent: ScrapedEvent = {
            ...detailPageEventData, // Base from detail page (includes permalink, lat, long from detail's address)
            name: detailPageEventData.name, // Detail page name is primary
            startAt: detailPageEventData.startAt, // Detail page startAt is primary
            endAt: detailPageEventData.endAt,
            imageUrls: Array.from(new Set([...(partialEventFromList.imageUrls || []), ...(detailPageEventData.imageUrls || [])])),
            host: detailPageEventData.host ?? partialEventFromList.host ?? null,
            hostLink: detailPageEventData.hostLink ?? partialEventFromList.hostLink ?? null,
            description: detailPageEventData.description || partialEventFromList.description || null,
            price: detailPageEventData.price ?? partialEventFromList.price ?? null,
            // Use detail page address and its geocoding by default. If detail address is empty, use list's.
            address: detailPageEventData.address.length > 0 ? detailPageEventData.address : partialEventFromList.address || [],
            tags: Array.from(new Set([...(partialEventFromList.tags || []), ...(detailPageEventData.tags || [])])),
        };

        // If address came from list or was empty on detail, re-geocode if necessary
        if (finalEvent.address.length > 0 && (detailPageEventData.address.length === 0 || !finalEvent.latitude || !finalEvent.longitude)) {
            if (JSON.stringify(finalEvent.address) !== JSON.stringify(detailPageEventData.address)) { // Address changed due to merge
                const coords = await geocodeAddressFromEvent(finalEvent.address);
                finalEvent.latitude = coords?.lat ?? null;
                finalEvent.longitude = coords?.lng ?? null;
            }
        }
        return finalEvent;
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
            const pageHtml = await fetchWithTimeout(pageUrl);
            if (!pageHtml) {
                console.error(`Failed to fetch page ${currentPage}. Stopping.`);
                keepFetching = false;
                break;
            }

            try {
                const partialEvents = await this._parseListPage(pageHtml);
                if (partialEvents.length === 0) {
                    console.error(`Stopped fetching: No events found on page ${currentPage}.`);
                    keepFetching = false;
                    break;
                }

                console.error(` Processing ${partialEvents.length} events from page ${currentPage}...`);
                for (const partialEvent of partialEvents) {
                    try {
                        // console.error(`  Fetching details for: ${partialEvent.name}`);
                        const detailedEvent = await this._processListItem(partialEvent);
                        console.error(detailedEvent);
                        if (detailedEvent) {
                            allEvents.push(detailedEvent);
                        } else {
                            // console.warn(`Failed to get complete details for event: ${partialEvent.name} (${partialEvent.permalink})`);
                        }
                    } catch (error) {
                        console.error(`Error processing event item "${partialEvent.name || 'Unknown'}":`, error);
                    }
                }
            } catch (error) {
                console.error(`Error processing page ${currentPage}:`, error);
            }

            currentPage++;
            if (currentPage > 1) { // Process only first page for now.
                console.error("Limiting to first page of results for now. Modify script to remove this limit.");
                keepFetching = false;
            }
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
    const scraper = new SeijetztScraper();
    if (process.argv.length > 2) {
        console.log(await scraper.scrapeHtmlFiles(process.argv.slice(2)))
    } else {
        console.log(await scraper.scrapeWebsite())
    }
}

