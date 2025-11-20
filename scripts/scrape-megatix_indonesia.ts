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
    baliDateToIsoStr,
} from "./common.ts";
import { geocodeAddressCached } from "../src/lib/server/google.ts";

export class WebsiteScraper implements WebsiteScraperInterface {
    async scrapeWebsite(): Promise<ScrapedEvent[]> {
        const allEvents: ScrapedEvent[] = [];

        const pagesToFetch = [0,1,2,3,4,5,6,7,8,9,10];
        for (const page of pagesToFetch) {
            const pageResults = await (customFetch(`https://megatix.co.id/api/v2/events/search?page=${page}&pageSize=16&search`, { returnType: 'json' }) as Promise<SearchEntry>);
            for (const result of pageResults.data) {
                const event = await this.extractEntryData(result);
                if (event) allEvents.push(event);
            }
        }
        console.log({ allEvents });

        console.error(`--- Scraping finished. Total events collected: ${allEvents.length} ---`);
        return allEvents;
    }

    async extractEntryData(entry: SearchEntry['data'][number]): Promise<ScrapedEvent | undefined> {
        const host = entry.promoter_name;

        const hostsToInclude = ['the yoga barn', 'paradiso '];
        if (!hostsToInclude.some(x => host.toLowerCase().includes(x))) {
            console.log(`Skipping ${entry.name} because it is not hosted by known host`);
            return undefined;
        }

        const name = entry.name;
        const imageUrls = entry.cover ? [entry.cover] : [];
        const sourceUrl = `https://megatix.co.id/event/${entry.slug}`;
        const eventData = await (customFetch(`https://megatix.co.id/api/v3/events/${entry.id}`, { returnType: 'json' }) as Promise<EventData>)
        const data = eventData.data;
        const description = cleanProseHtml(data.description);
        let [year, month, day] = entry.start_datetime.split(' ')[0].split('-').map(x => parseInt(x));
        let [hour, minute] = entry.start_datetime.split(' ')[1].split(':').map(x => parseInt(x));
        const startAt = baliDateToIsoStr(year, month, day, hour, minute);
        [year, month, day] = entry.end_datetime.split(' ')[0].split('-').map(x => parseInt(x));
        [hour, minute] = entry.end_datetime.split(' ')[1].split(':').map(x => parseInt(x));
        const endAt = baliDateToIsoStr(year, month, day, hour, minute);
        const address: string[] = [] 
        if (data.venue?.full_address?.includes('The Yoga Barn')) {
            address.push('The Yoga Barn', 'Ubud');
        } else if (data.venue?.full_address?.includes('Paradiso ')) {
            address.push('Paradiso ', 'Ubud');
        } else {
            data.venue.full_address?.split(',').map(part => part.trim())
        }
        const coordinates = data.venue.latitude && data.venue.longitude 
            ? { lat: data.venue.latitude, lng: data.venue.longitude } 
            : await geocodeAddressCached(address, process.env.GOOGLE_MAPS_API_KEY || '');
        const price = entry.display_price
        

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
            tags: [],
            sourceUrl,
            source: 'megatix_indonesia' as const
        } satisfies ScrapedEvent;
        console.log({ event });
        return event;
    }
    extractEventData(html: string, url: string): Promise<ScrapedEvent | undefined> {
        throw new Error("Method not implemented.");
    }
    scrapeHtmlFiles(filePath: string[]): Promise<ScrapedEvent[]> {
        throw new Error("Method not implemented." + filePath);
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


type EventData = {
    data: {
      id: number
      promoter_id: number
      name: string
      description: string
      cover: string
      checkout_cover: any
      banner: any
      booking_image_url: any
      background_colour: any
      is_password_protected: boolean
      discount_as_password_enabled: boolean
      is_sales_closed: boolean
      countdown_enabled: boolean
      on_sale_datetime: any
      is_on_sale_soon: boolean
      api_time: string
      api_time_local: string
      start_datetime: any
      end_datetime: any
      locale: string
      is_r_rated: boolean
      age_range: string
      rating: string
      is_free: boolean
      is_recurring: boolean
      is_transport: boolean
      currency_code: string
      currency_code_iso4217: string
      payment_gateway: string
      zippay_enabled: boolean
      afterpay_enabled: boolean
      pace_enabled: boolean
      atome_enabled: boolean
      backpocket_enabled: boolean
      paypal_enabled: boolean
      payto_enabled: boolean
      payments_123_disabled: boolean
      enable_2c2p_instalments: boolean
      gateway_fees: {
        fixedFee: number
        percentageFee: number
        minimumFee: number
        paymentUrl: any
        upliftFixedFee: number
        upliftPercentageFee: number
        currency_code: string
      }
      transaction_fees: any
      gateway_payment_url: any
      payment_options: any
      doku_mall_id: string
      hide_breakdown: boolean
      split_fee_listing: boolean
      hide_end_times: boolean
      show_end_time: boolean
      slug: string
      facebook: {
        pixel: any
        campaign: any
        confirmation_pixel: any
      }
      google: {
        conversion_code: any
      }
      twitter: {
        pixel: any
        checkout: any
        conversion: any
      }
      tickets: Array<{
        id: number
        name: string
        ticket_group_id: any
        ticket_page_id: any
        subtitle?: string
        is_free: boolean
        price: number
        rounding: number
        booking_fee: number
        fixed_transaction_fee: number
        event_protect_fee: number
        promoter_rebate: number
        price_display: number
        fees_display: any
        hide_fees: any
        hide_breakdown: any
        split_fee_listing: boolean
        min_tickets: number
        max_allowed: number
        multiplier: number
        is_invisible: boolean
        hide_on_allocation_exhausted: boolean
        is_on_sale_soon: boolean
        is_sold_out: boolean
        is_sales_closed: boolean
        allocation_exhausted: boolean
        show_remainder: boolean
        pos_enabled: boolean
        free_seats_count: number
        buy_x: any
        get_y_free: any
        hide_dropdown: boolean
        is_return: boolean
        session_ids: any
        payment_options: any
        notes: any
        is_companion_card: boolean
        upgrade_price: any
        image: string
        ems_credential_profile_id: any
        ticket_types: any
      }>
      ticket_groups: Array<any>
      ticket_pages: Array<any>
      extras: Array<any>
      venue: {
        id: number
        name: string
        full_address: string
        suburb: string
        phone: any
        email: any
        country_code: string
        latitude: any
        longitude: any
        about_text: any
        image_url: string
        timezone: string
      }
      is_ticket_suppressed: boolean
      enable_captcha: boolean
      has_questions: boolean
      question_set: any
      pos_enabled: boolean
      cash_enabled: boolean
      other_payments_enabled: boolean
      autoscan: string
      is_ecommerce: boolean
      accept_card_type: any
      delivery: any
      stripe_connect_account: any
      user_details_options: {
        address_required: boolean
        suburb_required: boolean
        state_required: boolean
        country_required: boolean
        postcode_required: boolean
        phone_required: boolean
        dob_required: boolean
        gender_required: boolean
        user_details_per_ticket: boolean
        disable_email_required_per_ticket: boolean
      }
      change_details_percent: any
      change_details_minimum: any
      order_fee_fixed: number
      order_fee_percent: any
      order_fee_name: string
      event_protect_percent: number
      refund_protect_enabled: boolean
      refund_protect_percent: string
      xcover_enabled: boolean
      transaction_uplift_enabled: boolean
      accessibility_enabled: boolean
      ekko_carbon_enabled: boolean
      ems_enabled: boolean
      ems_project_id: any
      has_ems_event: boolean
      tiktok_discovery_enabled: number
      instalment_count: any
      instalment_final_datetime: any
      laybuy_deposit_amount: number
      laybuy_final_datetime: any
      is_deposit: boolean
      is_sold_out: boolean
      allocation_exhausted: boolean
      registration_waitlist_enabled: boolean
      presale_waitlist_enabled: boolean
      sold_out_waitlist_enabled: boolean
      waitlist_name_required: boolean
      waitlist_phone_required: boolean
      waitlist_dob_required: boolean
      checkout_complete_html: any
      covid_region: any
      disable_facebook_login: boolean
      fast_checkout_enabled: boolean
      max_orders_per_account: any
      preregistration_enabled: boolean
      reservation_enabled: boolean
      reservation_options: {
        reservation_header: string
        reservation_page1_subheader: any
        reservation_page1_description: string
        reservation_page1_button_text: string
        reservation_page1_button_text_mobile: string
        reservation_page2_subheader: string
        reservation_page2_description: string
        reservation_page2_button_text: string
        reservation_page3_subheader: string
        reservation_page3_description: string
        reservation_payment_disclaimer: string
      }
      afterpay_stripe_connect_enabled: boolean
      requires_affiliate: boolean
      whatsapp_enabled: boolean
    }
    meta: {
      locales: {
        "0": string
        "2": string
        "4": string
        "5": string
        "6": string
        "7": string
        "8": string
        "9": string
        "10": string
      }
    }
  }

type SearchEntry = {
    data: Array<{
      id: number
      name: string
      slug: string
      promoter_name: string
      venue_name: string
      country_code: string
      is_recurring: boolean
      is_published: boolean
      is_on_sale: boolean
      cover: string
      banner: string
      visibility: string
      currency_code: string
      display_price: string
      is_ecommerce: boolean
      ekko_carbon_enabled: boolean
      user_affiliate_code: any
      start_datetime: string
      start_datetime_formatted: string
      end_datetime: string
      on_sale_datetime: any
    }>
    links: {
      first: string
      last: string
      prev: string
      next: string
    }
    meta: {
      current_page: number
      from: number
      last_page: number
      links: Array<{
        url?: string
        label: string
        active: boolean
      }>
      path: string
      per_page: number
      to: number
      total: number
    }
  }
  