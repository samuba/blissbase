# Filter events

Event filters let a user open the filter dialog, choose categories, apply them, and see the homepage list update.

## Sub-features

- `filter-open` opens the filter dialog from the header control.
- `filter-categories` shows wrapping category chips inside the dialog.
- `filter-apply` applies the selection and closes the dialog.
- `filter-results` keeps matching events and hides others.

## How to get to it (user POV)

- Choose `open-filter-dialog` on `/`.

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- `control-blissbase seed baseline` has Meditation Workshop and Yoga Flow Class.
- Browser is on `/` with cards visible and hydrated.

- **Open dialog.** Run `control-blissbase browser click --testid open-filter-dialog`. Then `control-blissbase browser expect-visible --testid filter-dialog`.
- **See categories.** Run `control-blissbase browser expect-visible --testid category-selection-wrap` and `control-blissbase browser expect-visible --testid category-chip-meditation`.
- **Apply meditation.** Run `control-blissbase browser click --testid category-chip-meditation` then `control-blissbase browser click --testid filter-apply`. The dialog is gone (`expect-count --testid filter-dialog --count 0`).
- **Confirm results.** Run `control-blissbase browser expect-visible --testid event-card-title --text "Meditation Workshop"` and `control-blissbase browser expect-count --testid event-card-title --count 0 --text "Yoga Flow Class"`.
- **Proof.** Run `control-blissbase browser snapshot --path event-filters/filtered.aria.txt` and `control-blissbase browser screenshot --path event-filters/filtered.png`. Artifacts show the filtered homepage list.

## Gotchas

- Category chips also exist outside the dialog on the homepage; when proving the dialog path, click chips that are inside `filter-dialog` after opening it (the homepage chips share the same test ids — open the dialog first and apply via `filter-apply`).
- Escape closes without applying; prove apply with `filter-apply`.
- Location/distance filtering needs Places mocks or cookie prefill; do not claim GPS/autocomplete success without those preconditions.
