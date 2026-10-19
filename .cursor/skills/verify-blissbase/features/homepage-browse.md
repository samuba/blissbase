# Browse homepage events

Homepage browse lets a user land on `/`, see Blissbase branding, scan upcoming event cards, and narrow the list with category chips.

## Sub-features

- `home-logo` shows the hero logo identifying Blissbase.
- `home-search-bar` shows the text search input and filter opener.
- `home-cards` lists seeded events with visible titles.
- `home-category` filters the list when a category chip is chosen.

## How to get to it (user POV)

- Open `/` (Events tab / home).
- Choose `nav-home` or `nav-events` when already elsewhere in the app.

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- `control-blissbase seed baseline` has created Meditation Workshop, Yoga Flow Class, and Online Breathwork Session.

- **Open home.** Run `control-blissbase browser goto --path /`, then `control-blissbase browser wait --testid event-card` and `control-blissbase browser hydrate`. Event cards are visible.
- **Confirm brand.** Run `control-blissbase browser expect-visible --testid hero-logo`. The hero logo is visible.
- **Confirm chrome.** Run `control-blissbase browser expect-visible --testid event-search-input` and `control-blissbase browser expect-visible --testid open-filter-dialog`. Search and filter controls are visible.
- **Confirm cards.** Run `control-blissbase browser expect-visible --testid event-card-title --text "Meditation Workshop"`. At least one titled card is visible.
- **Category filter.** Run `control-blissbase browser click --testid category-chip-meditation`. Then `control-blissbase browser expect-visible --testid event-card-title --text "Meditation Workshop"` and `control-blissbase browser expect-count --testid event-card-title --count 0 --text "Yoga Flow Class"`.
- **Proof.** Run `control-blissbase browser snapshot --path homepage-browse/home.aria.txt` and `control-blissbase browser screenshot --path homepage-browse/home.png`. Artifacts show Blissbase and Meditation Workshop.

## Gotchas

- Wait for `event-card` and `hydrate` before asserting filters; first Vite SSR can flash an error page.
- Category chips use slug test ids (`category-chip-meditation`, `category-chip-dance`), not display labels.
- Deselecting a chip restores the unfiltered list; prove both states when claiming toggle behavior.
