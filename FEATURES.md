# Features

## Auto Location Detection for New Users

Blissbase can automatically prefill the event location filter for first-time users.

### What happens

- On first visit, the app may set the search location automatically.
- A default search radius of `50` km is applied.
- A small info banner is shown above the existing location input:
  - `Dir werden Events um <location> angezeigt. Wenn das nicht dein Standort ist, ändere ihn hier:`

### When auto-detection runs

Auto-detection only runs if all of these are true:

- No location has been set before.
- A location can be identified for the user.

### When auto-detection does not run

- If the user has already set a location manually.
- If the user has used browser geolocation.
- If the user has cleared/reset filters.
- If the user dismissed the auto-location info banner.
- If no reliable location can be identified.
