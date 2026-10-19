# Complete single-day date range on close

Choosing one calendar day and closing the date picker treats that day as both the begin and end of the range. The trigger never stays with an empty end date.

## Sub-features

- `date-picker-open` opens the Zeitraum picker from the filter dialog.
- `date-picker-single-day` selects exactly one calendar day.
- `date-picker-close-completes` closes the popover and completes begin=end for that day.
- `date-picker-trigger-complete` shows both ends filled (no empty `tt.mm.jjjj` placeholders).

## How to get to it (user POV)

- Choose `open-filter-dialog` on `/`, then open the Zeitraum control.

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- `control-blissbase seed baseline` has seeded events.
- Browser is on `/` with cards visible and hydrated.
- Filter dialog is open (`control-blissbase browser click --testid open-filter-dialog` then `expect-visible --testid filter-dialog`).

- **Open picker.** Run `control-blissbase browser click --testid date-range-picker-trigger`. Then `control-blissbase browser expect-visible --testid date-range-day-2026-10-21` (use a seeded-month day that exists in the visible grid; adjust the ISO day if the calendar month under test differs).
- **Select one day.** Run `control-blissbase browser click --testid date-range-day-2026-10-21`.
- **Close popover.** Run `control-blissbase browser press --key Escape`.
- **Confirm complete range.** Run `control-blissbase browser expect-text --testid date-range-picker-trigger --text 21.10.2026`. The trigger text must include the same day twice (begin and end) and must not include empty end placeholders `tt.mm.jjjj`.
- **Proof.** Run `control-blissbase browser snapshot --path date-range-single-day/completed.aria.txt` and `control-blissbase browser screenshot --path date-range-single-day/completed.png`.

## Gotchas

- Escape closes the date popover first while the filter dialog stays open. That is the close path under test.
- Bits-UI keeps start-only as an intermediate selection until close; do not assert completeness before Escape.
- Calendar day test ids use the CalendarDate string (`YYYY-MM-DD`). Outside-month cells may be disabled.
- Until day test ids exist, role+name clicks with the German accessible name (e.g. `Mittwoch, 21. Oktober 2026`) are an interim drive path only.
