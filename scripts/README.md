# Event Scraping Scripts

This directory contains scripts for scraping event data from various websites. Each script follows a similar pattern but is customized for the specific website structure.

## Common Utilities

The scripts share common functionality through `common.ts`, which includes:

- `fetchWithTimeout`: Fetches URLs with a 10-second timeout and error handling
- `parseGermanDate`: Parses German date formats (DD.MM.YYYY) into ISO format
- `parseGermanDateTime`: Parses dates with separate time strings
- `parseDateTimeRange`: Handles date ranges with start and end times
- `makeAbsoluteUrl`: Converts relative URLs to absolute ones
- `geocodeAddressFromEvent`: Geocodes event addresses with caching

## Available Scripts

### scrape-awara.ts

Scrapes events from awara.events, handling AJAX pagination and detailed event pages.

```bash
bun run scripts/scrape-awara.ts > events.json
```

### scrape-heilnetz.ts

Scrapes events from heilnetz.de with support for LD+JSON data extraction.

```bash
# Scrape from web
bun run scripts/scrape-heilnetz.ts > events.json

# Process a local file
bun run scripts/scrape-heilnetz.ts <path_to_html_file> > event.json
```

### scrape-seijetzt.ts

Scrapes events from sei.jetzt, handling redirects for pagination detection.

```bash
# Scrape from web
bun run scripts/scrape-seijetzt.ts > events.json

# Process a local file
bun run scripts/scrape-seijetzt.ts <path_to_html_file> > event.json
```

### scrape-tribehaus.ts

Scrapes events from tribehaus.org with two-phase approach: collect permalinks, then process events.

```bash
bun run scripts/scrape-tribehaus.ts > events.json
```

## Implementation Notes

- All scripts are designed to fail gracefully when an individual event cannot be processed
- Timeouts are standardized to 10 seconds for all HTTP requests
- Appropriate delays are added between requests to be polite to servers
- Error handling is robust to ensure maximum data collection despite issues
- Geocoding is done with caching to reduce API calls for repeated addresses
