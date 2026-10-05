# Breathwork event search

Pages on breathwork.global can embed this search and list Blissbase breathwork events by city and date.

## Embed

```html
<script
  src="https://www.blissbase.app/embed/event-search-snippet.js"
  location-id="196"
  initial-limit="2"
  async
></script>
<div id="app"></div>
```

Use `www.blissbase.app`. `blissbase.app` redirects there without CORS headers, and the browser then drops the search.

The script renders into `#app`. If that element is missing, it creates one next to the script tag.

`location-id` fixes the city and hides the city select. Leave it off and the visitor picks a city. The ids match the previous snippet:

| id | city |
| --- | --- |
| 195 | Berlin |
| 196 | Hamburg |
| 197 | München |
| 198 | Köln |
| 199 | Frankfurt |
| 200 | Hannover |
| 201 | Stuttgart |
| 202 | Düsseldorf |
| 203 | Wien |
| 204 | Graz |
| 206 | Zürich |
| 205 | Bern |

`initial-limit` loads that many events as soon as the widget is ready. “Mehr Events anzeigen” then loads the next page, and further pages load on scroll. Without `initial-limit`, nothing loads until the visitor searches. The date range starts as today through 40 days later, and each search asks for 8 events.

`https://breathwork.global`, `https://www.breathwork.global`, and local `http://localhost` / `http://127.0.0.1` pages can use the search. Other sites can load the script file, but the browser blocks the request.

To try it on your machine, run the app and open `http://localhost:5173/embed/breathwork.global.html`. That page loads this snippet inside a small host site and searches your local events.

## Endpoint

The script `POST`s JSON to `https://www.blissbase.app/api/embed/breathwork.global`.

```json
{
  "locationId": 196,
  "limit": 8,
  "start": "2026-10-04",
  "end": "2026-11-13",
  "searchTerm": "breathwork",
  "cursor": null
}
```

`locationId` is the city id from the table above. `city` (`"Hamburg"`) works in its place. `start` and `end` are `YYYY-MM-DD`. `cursor` is the `nextCursor` from the previous response. The snippet sends `searchTerm`, and the route ignores it. Results are always events in the breathwork category, inside the chosen dates, within 50 km of the city.

```json
{
  "results": [
    {
      "id": 1,
      "name": "Atemkreis",
      "startDate": "2026-10-07",
      "endDate": "2026-10-07",
      "url": "https://blissbase.app/atemkreis",
      "imageUrl": "https://example.com/image.jpg",
      "venue": "Beispielstraße 1, 20457 Hamburg"
    }
  ],
  "nextCursor": "8"
}
```

`nextCursor` is `null` when there are no further events. A bad date, an unknown city, or a failed search returns `{ "results": [], "nextCursor": null }`.
