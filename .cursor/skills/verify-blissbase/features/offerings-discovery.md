# Discover offerings

Offerings discovery lets a user open the Offerings tab, see listed offerings backed by eligible public profiles near a location, and narrow them with text search.

## Sub-features

- `offerings-nav` opens `/offerings` from the desktop nav.
- `offerings-list` shows eligible listed offering cards.
- `offerings-search` filters by title, description, or profile name via `searchTerm`.

## How to get to it (user POV)

- Choose `nav-offerings` in the desktop nav.
- Open `/offerings` with location query params (`location`, `distance`, `lat`, `lng`).

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- A complete profile and a listed offline offering exist near Berlin (seed via E2E `createProfile` + `createOffering`). If `control-blissbase seed` does not yet expose those targets, report `verified-unreachable` for list/search bullets and only prove nav reachability.
- Location query uses Berlin: `location=Berlin&distance=50&lat=52.52&lng=13.405`.

- **Nav entry.** Run `control-blissbase browser goto --path /`, `control-blissbase browser hydrate`, then `control-blissbase browser click --testid nav-offerings`. The offerings page loads.
- **List with location.** Run `control-blissbase browser goto --path "/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405"`. Expect `offering-card` for the seeded listed offering and no card for an unlisted twin.
- **Search.** Append `&searchTerm=somatic` (or fill `event-search-input` on the offerings page — same test id as homepage search — and press Enter). Expect only the matching offering card.
- **Proof.** Run `control-blissbase browser snapshot --path offerings-discovery/list.aria.txt` and `control-blissbase browser screenshot --path offerings-discovery/list.png`. Artifacts show offering cards for the eligible listing.

## Gotchas

- Unlisted offerings and offerings whose profile lacks contact links stay hidden; seeding an incomplete profile is not a list proof failure.
- Offerings text search reuses `event-search-input`; prove while the path is `/offerings`.
- Desktop nav test ids are `nav-events`, `nav-offerings`, `nav-favorites`, `nav-profile`. Favorites/profile may require login.
