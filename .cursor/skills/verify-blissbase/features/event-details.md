# Open event details

Event details lets a user open an event from a homepage card into a details dialog, read title and location, and dismiss the dialog back to the list.

## Sub-features

- `details-open` opens the details dialog from an event card.
- `details-content` shows title and address content in the dialog.
- `details-close` dismisses via Escape or the dialog close control.

## How to get to it (user POV)

- Choose an `event-card` on `/`.
- Open a direct event URL `/[slug]` when the slug is known.

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- `control-blissbase seed baseline` (or at least `seed meditation`) has created Meditation Workshop at Zen Center, Berlin.
- Browser is on `/` with cards visible and hydrated.

- **Open from card.** Run `control-blissbase browser click --testid event-card`. Then `control-blissbase browser expect-visible --testid details-dialog` and `control-blissbase browser expect-visible --testid event-title`.
- **Confirm location.** Run `control-blissbase browser expect-visible --testid event-address-link --text "Zen Center"`. The address link includes Berlin.
- **Dismiss.** Run `control-blissbase browser press --key Escape`. Then `control-blissbase browser expect-count --testid details-dialog --count 0`. The URL is `/` again.
- **Proof.** Before dismiss, run `control-blissbase browser snapshot --path event-details/open.aria.txt` and `control-blissbase browser screenshot --path event-details/open.png`. Artifacts show the dialog and Meditation Workshop.

## Gotchas

- Prefer `event-card` click over deep-linking when proving the list→dialog path.
- Close with Escape or `dialog-close`; do not use browser back as the only close proof unless also asserting URL sync.
- Address parts are joined with a middle dot (`·`), not a comma.
