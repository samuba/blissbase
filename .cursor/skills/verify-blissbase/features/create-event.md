# Create an event

Create event lets a user start the publish wizard from the homepage CTA, fill event fields when signed in with a complete profile, and land on the new event details dialog.

## Sub-features

- `create-cta` opens `/events/new` from the homepage create control without a login dialog for anonymous users.
- `create-signed-in-online` publishes an online event for a signed-in complete profile.
- `create-confirm` shows the new event title in `details-dialog`.

## How to get to it (user POV)

- Choose the visible `create-event` control on `/`.
- Open `/events/new` directly.

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- For the signed-in path: seed a complete profile via the E2E seed API (`createProfile` with the default E2E user id) before `browser sign-in`. If the profile seed helper is not yet exposed on `control-blissbase seed`, report `verified-unreachable` with that precondition rather than weakening the journey.
- Google Places is not required for the online path.

- **CTA entry.** Run `control-blissbase browser goto --path /`, `control-blissbase browser hydrate`, then `control-blissbase browser click --testid create-event`. Run `control-blissbase browser goto --path /events/new` only when proving the direct URL entry. Expect `create-event-heading` with `data-step=event` for the anonymous CTA path (no `google-login-button` on first paint of the event step).
- **Signed-in online publish.** After profile seed + `control-blissbase browser sign-in`, run `control-blissbase browser goto --path /events/new`. Fill `event-name-input` with `E2E Online Event`, mark online via `event-online-checkbox`, fill the description editor, then click `wizard-primary`. Expect `details-dialog` and `event-title` text `E2E Online Event`.
- **Proof.** Run `control-blissbase browser snapshot --path create-event/published.aria.txt` and `control-blissbase browser screenshot --path create-event/published.png`. Artifacts show the details dialog title.

## Gotchas

- Prefer the online path for harness proof; offline location autocomplete needs Places mocks (`tests/e2e/helpers/offering-test-utils.ts`).
- Anonymous OTP publish uses fixed OTP `123456` and extra profile steps — follow `tests/e2e/events-create.spec.ts` if extending the CLI.
- A publishing overlay (`create-flow-publishing`) can appear briefly; wait for `details-dialog` rather than a fixed sleep.
