import { describe, expect, it } from 'vitest';
import {
	getAddress,
	getEndAt,
	getImageUrls,
	getName,
	getStartAt,
	getTags,
	isPublicHoliday,
	mapBaliTravelHubEvent,
	parseCliArgs,
} from './scrape-balitravelhub.ts';

const festivalHtml = `<!doctype html>
<html><head>
<meta property="article:published_time" content="2027-04-13T18:00:00+00:00" />
<meta property="og:image" content="https://www.balitravelhub.com/wp-content/uploads/2015/04/Bali-Spirit-Festival.jpg" />
<link rel="canonical" href="https://www.balitravelhub.com/events/bali-spirit-festival/" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Bali Spirit Festival",
      "articleSection": ["Events"]
    },
    {
      "@type": "Festival",
      "@id": "https://www.balitravelhub.com/events/bali-spirit-festival/#hp-event",
      "name": "Bali Spirit Festival",
      "startDate": "2027-04-22",
      "endDate": "2027-04-25",
      "description": "Wellness festival in Ubud.",
      "location": {
        "@type": "Place",
        "name": "The Yoga Barn",
        "address": "Jalan Sukma Kesuma, Peliatan, Ubud",
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": -8.5196475,
          "longitude": 115.266119
        }
      }
    }
  ]
}
</script>
</head><body>
<article>
  <h1 class="entry-title">Bali Spirit Festival</h1>
  <div class="entry-content herald-entry-content">
    <p>The Bali Spirit Festival brings yoga, music and healing to Ubud.</p>
  </div>
</article>
</body></html>`;

const holidayHtml = `<!doctype html>
<html><head>
<meta property="article:published_time" content="2027-03-07T18:00:00+00:00" />
<meta property="og:image" content="https://www.balitravelhub.com/wp-content/uploads/2018/03/Nyepi.jpg" />
<link rel="canonical" href="https://www.balitravelhub.com/events/nyepi/" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      "headline": "Nyepi",
      "articleSection": ["Events", "Public Holidays"]
    }
  ]
}
</script>
</head><body class="archive category category-events category-public-holidays">
<article>
  <h1 class="entry-title">Nyepi</h1>
  <div class="meta-category"><a rel="category tag" href="/events/public-holidays/">Public Holidays</a></div>
  <div class="entry-content herald-entry-content">
    <p>Nyepi, Bali's Day of Silence, falls on Monday, 8 March 2027.</p>
  </div>
</article>
</body></html>`;

const staleSchemaHtml = `<!doctype html>
<html><head>
<meta property="article:published_time" content="2027-08-05T18:00:00+00:00" />
<meta property="og:image" content="https://www.balitravelhub.com/wp-content/uploads/jazz.jpg" />
<link rel="canonical" href="https://www.balitravelhub.com/events/ubud-village-jazz-festival/" />
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MusicEvent",
      "name": "Ubud Village Jazz Festival",
      "startDate": "2026-08-07",
      "endDate": "2026-08-08",
      "location": {
        "@type": "Place",
        "name": "Sthala Hotel",
        "address": "Jalan A.A Gede Rai",
        "geo": { "@type": "GeoCoordinates", "latitude": -8.57, "longitude": 115.26 }
      }
    }
  ]
}
</script>
</head><body>
<h1 class="entry-title">Ubud Village Jazz Festival</h1>
<div class="entry-content"><p>Jazz in Ubud.</p></div>
</body></html>`;

describe(`scrape-balitravelhub`, () => {
	it(`reads Festival JSON-LD dates, venue and image`, async () => {
		expect(getName(festivalHtml)).toBe(`Bali Spirit Festival`);
		expect(getStartAt(festivalHtml)).toBe(`2027-04-22T00:00:00+07:00`);
		expect(getEndAt(festivalHtml)).toBe(`2027-04-25T00:00:00+07:00`);
		expect(getAddress(festivalHtml)).toEqual([
			`The Yoga Barn`,
			`Jalan Sukma Kesuma`,
			`Peliatan`,
			`Ubud`,
		]);
		expect(getImageUrls(festivalHtml)[0]).toContain(`Bali-Spirit-Festival.jpg`);
		expect(getTags(festivalHtml)).not.toContain(`Public Holidays`);
		expect(isPublicHoliday(festivalHtml)).toBe(false);

		const event = await mapBaliTravelHubEvent({
			html: festivalHtml,
			url: `https://www.balitravelhub.com/events/bali-spirit-festival/`,
		});
		expect(event?.source).toBe(`balitravelhub`);
		expect(event?.latitude).toBeCloseTo(-8.5196475);
		expect(event?.longitude).toBeCloseTo(115.266119);
		expect(event?.description).toContain(`yoga`);
	});

	it(`skips Public Holidays posts even when dates parse`, async () => {
		expect(isPublicHoliday(holidayHtml)).toBe(true);
		expect(getStartAt(holidayHtml)).toBe(`2027-03-08T00:00:00+07:00`);
		const event = await mapBaliTravelHubEvent({
			html: holidayHtml,
			url: `https://www.balitravelhub.com/events/nyepi/`,
		});
		expect(event).toBeUndefined();
	});

	it(`falls back to article:published_time in Asia/Jakarta when Event schema is missing`, () => {
		const noSchemaHtml = holidayHtml.replace(`"Public Holidays"`, `"Events"`).replace(
			`category-public-holidays`,
			`category-events`,
		).replace(`Public Holidays`, `Events`);
		expect(isPublicHoliday(noSchemaHtml)).toBe(false);
		expect(getName(noSchemaHtml)).toBe(`Nyepi`);
		expect(getStartAt(noSchemaHtml)).toBe(`2027-03-08T00:00:00+07:00`);
		expect(getEndAt(noSchemaHtml)).toBeUndefined();
		expect(getAddress(noSchemaHtml)).toEqual([`Bali`, `Indonesia`]);
	});

	it(`ignores past schema dates and uses published_time instead`, () => {
		expect(getStartAt(staleSchemaHtml)).toBe(`2027-08-06T00:00:00+07:00`);
		expect(getEndAt(staleSchemaHtml)).toBeUndefined();
	});

	it(`ignores scrape-websites runner flags`, () => {
		expect(parseCliArgs([`--dry-run`, `--limit`, `3`, `--log-dir`, `/tmp`])).toEqual({
			limit: 3,
			files: [],
		});
	});
});
