import { ScrapedEvent } from '../src/lib/types.ts';
import {
	customFetch,
	WebsiteScraperInterface,
	cleanProseHtml,
} from './common.ts';
import * as cheerio from 'cheerio';
import { matchesWhiteListWords } from '../src/whitelistWords.ts';
import { geocodeAddressCached } from '../src/lib/server/google.ts';

export class WebsiteScraper implements WebsiteScraperInterface {
	async scrapeWebsite(): Promise<ScrapedEvent[]> {
		let allEvents: ScrapedEvent[] = [];
		
		const html = await customFetch('https://www.whatsupdanang.com/events?view=list', { returnType: 'text' });
		
		// extract event permalinks using regex
		const permalinkRegex = /permalink\\":\\"(.*?)\\"/g;
		const permalinks: Set<string> = new Set();
		let match;
		while ((match = permalinkRegex.exec(html)) !== null) {
			if (match[1]) {
				permalinks.add(match[1]);
			}
		}
		console.log(`Found ${permalinks.size} event permalinks`, permalinks);

		const permalinkList = Array.from(permalinks);
		const batchSize = 5;

		for (let index = 0; index < permalinkList.length; index += batchSize) {
			const batchPermalinks = permalinkList.slice(index, index + batchSize);
			const batchEvents = await Promise.allSettled(
				batchPermalinks.map(async permalink => {
					try {
						const eventHtml = await customFetch(permalink, { returnType: `text` });
						return await this.extractEventData(eventHtml, permalink);
					} catch (error) {
						console.error(`Failed to scrape event permalink: ${permalink}`, error);
						return undefined;
					}
				})
			);
			allEvents.push(...batchEvents.filter((result): result is PromiseFulfilledResult<ScrapedEvent> => result.status === 'fulfilled').map(result => result.value));
		}
		console.log(`found ${allEvents.length} events`);
		allEvents = allEvents.filter(event => matchesWhiteListWords(event.name));
		console.log(`after filtering ${allEvents.length} events`);
		console.log(allEvents.map(event => event.name));

		console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
		return allEvents;
	}

	scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
		throw new Error('Method not implemented.' + filePath);
	}
	async extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
		const $ = await cheerio.load(html);

		const schemaJsonRegex = /({\\\\\\"@context\\\\\\":\\\\\\"https:\/\/schema\.org\\\\\\".*?"}}])/
		const schemaTxt = html.match(schemaJsonRegex)?.[0]?.replaceAll('\\', '')?.replace('}"}}]', '}')
		const schemaJson = JSON.parse(schemaTxt);
		// console.log(schemaJson);

		const name = schemaJson.name;
		const description = cleanProseHtml($(".prose").html());
		const imageUrls = [schemaJson.image];
		const startAt = schemaJson.startDate;
		const endAt = schemaJson.endDate; 
		const address = [schemaJson.location.name ?? '', ...schemaJson.location.address.split(',').map(x => x.trim())].filter(x => x);
		const latitude = schemaJson.location.geo.latitude;
		const longitude = schemaJson.location.geo.longitude;
		const sourceUrl = url;
		const host = schemaJson.organizer[0].name;

		const hostlinkRegex = /"permalink\\":\\"\/organisation\/(.*?)\\"/
		const hostLink = "https://www.whatsupdanang.com/organisation/" + html.match(hostlinkRegex)?.[1];

		const event = {
			name,
			description,
			imageUrls,
			startAt,
			endAt: undefined, // end date is fucked in the data
			address,
			price: undefined,
			priceIsHtml: false,
			host,
			hostLink,
			contact: [],
			latitude,
			longitude,
			tags: [],
			sourceUrl,
			source: 'whatsupdanang' as const
		} satisfies ScrapedEvent;
		console.log({ event });
		return event;
	}
	extractName(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractStartAt(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractEndAt(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractAddress(html: string): string[] | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractPrice(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractDescription(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractImageUrls(html: string): string[] | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractHost(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractHostLink(html: string): string | undefined {
		throw new Error('Method not implemented.' + html);
	}
	extractTags(html: string): string[] | undefined {
		throw new Error('Method not implemented.' + html);
	}
}

// Execute the main function only when run directly
if (import.meta.main) {
	try {
		const scraper = new WebsiteScraper();
		await scraper.scrapeWebsite();
	} catch (error) {
		console.error('Unhandled error in main execution:', error);
		process.exit(1);
	}
}
