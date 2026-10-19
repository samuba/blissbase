# Blissbase verification map

This directory is the maintained source for verifying user-facing Blissbase web behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `control-blissbase launch` so the instance uses `E2E_TEST=true` and an in-memory PGlite DB.
- Prefer ports `5190+` (`--port 5190`) so human `5173` and Playwright `5174+` stay free.
- Run `control-blissbase doctor` and require `ok: true` with our pid owning the port.
- Seed with `control-blissbase seed baseline` unless a feature file overrides.
- Browser locale is German (`de-DE` / `Accept-Language: de`). Assert German UI copy where the app shows it.
- Locate interactive elements only via `data-testid` through `control-blissbase browser … --testid …`.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Expand `control-blissbase` to `bun .cursor/skills/verify-blissbase/scripts/control-blissbase.ts` from the repo root.
- Run browser actions through `control-blissbase browser`.
- Restore seeded data with `seed reset` / `seed baseline` after a mutation. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with the Blissbase logo or brand heading visible.
- Mutation proof includes a second user-facing view or a seed read (`getEventBySlug` via the seed API).
- Record the feature ID and entry point used with every artifact under `.cursor/skills/verify-blissbase/artifacts/<feature-id>/`.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-blissbase` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Browse homepage events](./homepage-browse.md) covers logo, search bar, event cards, and category chips.
- [Search events](./event-search.md) covers text search filtering on the homepage.
- [Open event details](./event-details.md) covers opening and dismissing the event details dialog.
- [Filter events](./event-filters.md) covers the filter dialog and category application.
- [Create an event](./create-event.md) covers the create-flow CTA and signed-in publish path.
- [Discover offerings](./offerings-discovery.md) covers the offerings tab list and search.
