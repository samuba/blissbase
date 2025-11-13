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
    superTrim,
    baliDateToIsoStr,
    extractIcalStartAndEndTimes,
} from "./common.ts";
import * as cheerio from 'cheerio';
import { geocodeAddressCached } from "../src/lib/server/google.ts";

const baseUrl = 'https://xwdd-3kmq-rzh2.n7e.xano.io/api:iV56BXYl';

export class WebsiteScraper implements WebsiteScraperInterface {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];

        console.log("authenticating...");
        const loginResponse = await fetch(`${baseUrl}/auth/login?city_id=1`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'origin': 'https://vortexapp.dev',
              'referer': 'https://vortexapp.dev/'
            },
            body: JSON.stringify({
              'email': 'zenhold@gmail.com',
              'password': 'metatron55'
            })
          });
        const { authToken } = await loginResponse.json();

        console.log("fetching activities...");
        const now = new Date().getTime();
        const endDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).getTime(); // 14 days from now
        const activitiesRes = await fetch(`${baseUrl}/activity_occurrences?start_date=${now}&end_date=${endDate}&city_id=1`, {
            headers: {
              'accept': '*/*',
              'authorization': `Bearer ${authToken}`,
              'cache-control': 'no-cache',
              'content-type': 'application/json',
              'origin': 'https://vortexapp.dev',
              'pragma': 'no-cache',
              'referer': 'https://vortexapp.dev/'
            }
          });
        const activities = await activitiesRes.json() as VortexAppEvent[];

        console.log(`processing ${activities.length} activities...`);
        for (const activity of activities) {
            let host: string | undefined = activity.teacher_name
            if (host.includes('TBD') || host.includes('Tbd')) host = undefined;
            let name = activity._activity.name;
            if (host && !name.includes(host)) name = `${name} w/ ${host}`;

            let tag: string | undefined = activity._activity._activity_tag.name;
            if (tag.includes('Unassigned')) tag = undefined;

            const address = [activity._activity._center.center_data.name, "Ubud"];
            const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');

            const startDate = new Date(activity.start_date + (8 * 60 * 60 * 1000)); // bali is utc+8
            const startAt = baliDateToIsoStr(
                startDate.getUTCFullYear(),
                startDate.getUTCMonth() + 1,
                startDate.getUTCDate(),
                startDate.getUTCHours(), 
                startDate.getUTCMinutes()
            ); 

            const endDate = Number.isInteger(activity._activity.duration) ? new Date(activity.start_date + (8 * 60 * 60 * 1000) + activity._activity.duration * 60 * 1000)
                : undefined;
            const endAt = endDate ? baliDateToIsoStr(
                endDate.getUTCFullYear(),
                endDate.getUTCMonth() + 1,
                endDate.getUTCDate(),
                endDate.getUTCHours(), 
                endDate.getUTCMinutes()
            ) : undefined;

            if (!activity._activity.image_url) continue; // for now only events with images are included

            const event = {
                name,
                description: activity._activity.description,
                imageUrls: activity._activity.image_url ? [activity._activity.image_url] : [],
                startAt,
                endAt,
                address,
                price: Number.isInteger(activity._activity.price) ? (activity._activity.price / 1000) + "k" : activity._activity.price?.toString(),
                priceIsHtml: false,
                host,
                hostLink: undefined,
                contact: [],
                latitude: coordinates?.lat,
                longitude: coordinates?.lng,
                tags: tag ? [tag] : [],
                sourceUrl: activity._activity.booking_link,
                source: 'vortexapp' as const
            } satisfies ScrapedEvent;
            allEvents.push(event);
        }

        console.log(activities.length)

        console.log({ allEvents });

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }

    scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
        throw new Error("Method not implemented." + filePath);
    }
    async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
        const $ = await cheerio.load(html);
        const name = superTrim($('h1').text())!;
        const description = cleanProseHtml($('.event_content_single_page').html());
        const imageUrls = $('.data-entry-content-single-page .event-image-container .lightbox-scope img').map((_index, element) => $(element).attr('src')).get().filter(Boolean);

        const icalTimes = extractIcalStartAndEndTimes(html);
        const startAt = baliDateToIsoStr(
            parseInt(icalTimes.startAt!.slice(0, 4)),
            parseInt(icalTimes.startAt!.slice(4, 6)),
            parseInt(icalTimes.startAt!.slice(6, 8)),
            parseInt(icalTimes.startAt!.slice(9, 11)),
            parseInt(icalTimes.startAt!.slice(11, 13))
        );
        const endAt = baliDateToIsoStr(
            parseInt(icalTimes.endAt!.slice(0, 4)),
            parseInt(icalTimes.endAt!.slice(4, 6)),
            parseInt(icalTimes.endAt!.slice(6, 8)),
            parseInt(icalTimes.endAt!.slice(9, 11)),
            parseInt(icalTimes.endAt!.slice(11, 13))
        );
        // Fallback to parsing from URL and time text
        // const urlParts = url.split("/").reverse();
        // const time = superTrim($('.event_single_page_time').text()!.split('·')[1])!
        // const [startTime, endTime] = time.split(" - ");
        // startAt = baliDateToIsoStr(parseInt(urlParts[3]), parseInt(urlParts[2]), parseInt(urlParts[1]), parseInt(startTime.split(':')[0]), parseInt(startTime.split(':')[1]));
        // endAt = baliDateToIsoStr(parseInt(urlParts[3]), parseInt(urlParts[2]), parseInt(urlParts[1]), parseInt(endTime.split(':')[0]), parseInt(endTime.split(':')[1]));

        const address = superTrim($('.data-entry-content-single-page .event_curren_venue').text())!.split(',').map(part => part.trim());
        const price = superTrim($('.data-entry-content-single-page .event_ticket_price_single').text())!;
        const host = $('.data-entry-content-single-page .author-link').text()?.trim() || name.split(' w/ ')[1];
        const coordinates = await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');
        const sourceUrl = ($('.data-entry-content-single-page .ticket-link').attr('href')! ?? url).replace('TODOTODAY', '');
        const tags = $('.data-entry-content-single-page .event-category-label-no-image').map((_index, element) => $(element).text().trim()).get().filter(Boolean);

        const event = {
            name,
            description,
            imageUrls,
            startAt,
            endAt,
            address,
            price,
            priceIsHtml: false,
            host,
            hostLink: undefined,
            contact: [],
            latitude: coordinates?.lat,
            longitude: coordinates?.lng,
            tags,
            sourceUrl,
            source: 'todotoday' as const
        } satisfies ScrapedEvent;
        console.log({ event });
        return event;
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

export type VortexAppEvent = {
    id: number
    created_at: number
    activity_id: number
    start_date: number
    location: any
    teacher_name: string
    _activity: {
      id: number
      created_at: number
      name: string
      center_id: number
      price: number
      description: string
      activity_tag_id: number
      teacher_name: string
      duration: number
      visible: boolean
      image_url: string
      on_demand: boolean
      booking_link: any
      currency: any
      _center: {
        id: number
        created_at: number
        type: string
        reviewed: boolean
        logo_image_url: string
        image_url: string
        denial_message: any
        submitted: boolean
        teachers: Array<any>
        location_id: number
        teacher_data: {
          name: any
          description: any
          social_media_link: any
          tags: Array<any>
        }
        center_data: {
          name: string
          website: string
          description: string
          location_data: {
            address: string
            google_maps_link: string
          }
        }
      }
      _activity_tag: {
        id: number
        created_at: number
        name: string
        image_url: string
      }
      promoted: boolean
    }
    in_schedule: boolean
  }