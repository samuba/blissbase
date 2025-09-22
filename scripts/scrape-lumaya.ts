/**
 * Fetches event pages from heilnetz.de (starting from https://heilnetz.de/aktuelle-termine.html)
 * or processes a local HTML file if a path is provided as a command-line argument.
 *
 * When scraping from heilnetz.de:
 * - Iterates through all pagination pages.
 * - Fetches each event's detail page.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prioritizes data from LD+JSON script tags if available.
 * - Handles recurring events by extracting each occurrence with its specific date.
 *
 * When a local HTML file path is provided:
 * - Parses only that single HTML file.
 * - Extracts event data as JSON according to the ScrapedEvent interface.
 * - Prints the single event JSON to standard output.
 *
 * Requires Bun (https://bun.sh/).
 *
 * Usage:
 *   To scrape from the web: bun run scripts/scrape-heilnetz.ts > events.json
 *   To parse a local files:  bun run scripts/scrape-heilnetz.ts <path_to_html_file> <path_to_html_file> > event.json
 */
import { ScrapedEvent } from "../src/lib/types.ts";
import {
    customFetch,
    WebsiteScraperInterface,
    cleanProseHtml,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

export class WebsiteScraper implements WebsiteScraperInterface {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];
        const areaIds = [
            'berlin',
            'freiburg',
            'leipzig',
            'munich',
            'stuttgart',
        ]

        // TODO good contact mail/mesg handling abgucken

        for (const areaId of areaIds) {
            const events: LumayaEvent[] = await customFetch(`https://lumaya-backend-766263862808.europe-west10.run.app/api/v1/events/search?areaId=${areaId}`, { returnType: 'json' });

            for (const event of events) {
                if (event.state !== 'ACTIVE') continue;
                console.log(`Scraping event ${event.title}`)

                const address = event.location.address?.split(',')?.map(x => x.trim()) ?? [areaId.charAt(0).toUpperCase() + areaId.slice(1)]
                let coordinates: { lat: number, lng: number } | null = null;
                if (event.location.latitude && event.location.longitude) {
                    coordinates = { lat: event.location.latitude, lng: event.location.longitude }
                } else {
                    coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '')
                }

                let description = cleanProseHtml(event.description).replaceAll('\n', '<br>')
                if (event.contact.email || event.contact.whatsapp || event.contact.telegram) {
                    description += `<h4>Kontakt</h4> <div id="contact-area class="flex gap-2">`
                    if (event.contact.email) description += `<a href="mailto:${event.contact.email}" target="_blank" class="btn"><i class="icon-[ph--envelope] size-5"></i>Email</a><br>`
                    if (event.contact.whatsapp) description += `<a href="https://wa.me/${event.contact.whatsapp.replace('+', '')}" target="_blank" class="btn"><i class="icon-[ph--whatsapp-logo] size-5"></i>WhatsApp</a><br>`
                    if (event.contact.telegram) description += `<a href="tg://resolve?domain=${event.contact.telegram.replace('@', '')}" target="_blank" class="btn"><i class="icon-[ph--telegram-logo] size-5"></i>Telegram</a><br>`
                    description += `</div>`
                }

                for (const appointment of event.appointments) {
                    allEvents.push({
                        name: event.title,
                        description,
                        imageUrls: event.imageUrls,
                        startAt: appointment.startDate,
                        endAt: appointment.endDate,
                        address: event.location.address.split(',').map(x => x.trim()),
                        price: event.price.amount?.toString() ?? null,
                        priceIsHtml: false,
                        tags: event.categories,
                        latitude: coordinates?.lat,
                        longitude: coordinates?.lng,
                        contact: [event.contact.url, event.contact.email, event.contact.whatsapp, event.contact.telegram].filter(x => x) as string[],
                        host: event.contact.instagramUsername || undefined,
                        hostLink: event.contact.instagramUsername ? `https://www.instagram.com/${event.contact.instagramUsername.replace('@', '')}` : undefined,
                        sourceUrl: `https://lumaya.co/${areaId}/events/${event.slug}`,
                        source: 'lumaya',
                    })
                }
            }
        }

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }

    scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
        throw new Error("Method not implemented." + filePath);
    }
    extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
        throw new Error("Method not implemented." + html + url);
    }
    extractName(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractStartAt(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractEndAt(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractAddress(html: string): string[] | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractPrice(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractDescription(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractImageUrls(html: string): string[] | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractHost(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractHostLink(html: string): string | undefined {
        throw new Error("Method not implemented." + html);
    }
    extractTags(html: string): string[] | undefined {
        throw new Error("Method not implemented." + html);
    }
}

// Execute the main function only when run directly
if (import.meta.main) {
    try {
        const scraper = new WebsiteScraper();
        console.log(await scraper.scrapeWebsite())
    } catch (error) {
        console.error("Unhandled error in main execution:", error);
        process.exit(1);
    }
}

export type LumayaEvent = {
    id: string
    slug: string
    imageUrls: Array<string>
    imageUrl: string
    title: string
    description: string
    capacity: number
    price: {
        currency?: string
        amount?: number
    }
    promotion: {
        affiliateUrl?: string
        booster?: string
    }
    location: {
        isTba: boolean
        areaId: string
        address: string
        placesId?: string
        latitude?: number
        longitude?: number
    }
    contact: {
        telegram?: string
        whatsapp?: string
        email?: string
        url?: string
        instagramUsername?: string
    }
    categories: Array<string>
    appointments: Array<{
        startDate: string
        endDate: string
    }>
    state: string
    consent: {
        allowPostOnInstagram: boolean
    }
    seoTitle?: string
    seoDescription?: string
    hasSeoInformation: boolean
    creationDate: string
    recurrenceRuleOptions?: string
}