# Search events

Event search lets a user type a query on the homepage, submit it, and see only matching event cards without changing stored events.

## Sub-features

- `search-open` focuses the homepage text search input.
- `search-match` keeps title matches and hides non-matches.
- `search-empty` shows the no-results state for a query with no matches.

## How to get to it (user POV)

- Use the search field on `/` (`event-search-input`).
- Submit with Enter after typing a query.

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- `control-blissbase seed baseline` has created Meditation Workshop and Yoga Flow Class.
- Browser session is on `/` with cards visible (`wait --testid event-card`, `hydrate`).

- **Focus search.** Run `control-blissbase browser click --testid event-search-input`. The search input is focused.
- **Match yoga.** Run `control-blissbase browser fill --testid event-search-input --value Yoga` and `control-blissbase browser press --key Enter`. Then `control-blissbase browser expect-visible --testid event-card-title --text "Yoga Flow Class"` and `control-blissbase browser expect-count --testid event-card-title --count 0 --text "Meditation Workshop"`.
- **Empty state.** Run `control-blissbase browser fill --testid event-search-input --value volcano` and `control-blissbase browser press --key Enter`. Then `control-blissbase browser expect-visible --testid events-no-results`.
- **Proof.** After the yoga match step, run `control-blissbase browser snapshot --path event-search/results.aria.txt` and `control-blissbase browser screenshot --path event-search/results.png`. Artifacts identify Blissbase, the filtered list, and Yoga Flow Class.

## Gotchas

- Submit with Enter; blur alone may not apply the query.
- `event-search-input` is shared with the offerings page TextSearchInput — prove homepage search while the URL is `/`.
- Seeded titles are English in baseline fixtures; German UI chrome around them is still expected.
- Clearing search and proving the full list restored is a separate assertion; do not skip it when claiming clear behavior.
