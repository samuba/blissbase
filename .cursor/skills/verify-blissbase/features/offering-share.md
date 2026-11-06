# Share an offering

Sharing an offering copies a stable public URL on desktop and shows a confirmation. The same control is what phones use to open the system share sheet.

## Sub-features

- `share-visible` shows the share control on the offering page and in the details dialog.
- `share-copy` copies the offering URL on desktop.
- `share-stable-url` copies `https://blissbase.app/offerings/{slug}` with no filter or returnTo query.
- `share-feedback` shows “Link kopiert” after a successful copy.

## How to get to it (user POV)

- Choose an `offering-card` on `/offerings` with a location filter, then use `offering-share` in the details dialog.
- Open `/offerings/verify-offering-share` directly and use `offering-share` on the page.

## Driving it with control-blissbase

Preconditions:

- Blissbase is healthy (`control-blissbase doctor` → `ok: true`).
- `control-blissbase seed offering` has created Berlin Coaching Session (`verify-offering-share`) for the E2E profile in Berlin.
- Browser is German. Clipboard read and write are granted by the harness browser.

- **Dialog copy.** Run `control-blissbase browser goto --path "/offerings?location=Berlin&distance=50&lat=52.52&lng=13.405"`, `control-blissbase browser hydrate`, then `control-blissbase browser click --testid offering-card`. Expect `details-dialog` and `offering-share` with text `Link kopieren`. Run `control-blissbase browser click --testid offering-share`. Expect `share-copied` with text `Link kopiert`. `control-blissbase browser read-clipboard` returns `https://blissbase.app/offerings/verify-offering-share`.
- **Page copy.** Run `control-blissbase browser goto --path "/offerings/verify-offering-share?returnTo=%2Fofferings%3Flocation%3DBerlin"`, then `control-blissbase browser click --testid offering-share`. The address bar still contains `returnTo`. `read-clipboard` returns the same stable URL and does not include `returnTo`.
- **Proof.** After the dialog copy, run `control-blissbase browser snapshot --path offering-share/copied.aria.txt` and `control-blissbase browser screenshot --path offering-share/copied.png`. Artifacts show the offering dialog, the share control, and “Link kopiert”.

## Gotchas

- The copied URL always uses `https://blissbase.app`, including when the page origin is the local verify server.
- On a phone the same control is labeled Teilen and opens the system share sheet with that URL. The harness browser is desktop Chromium, so it takes the copy path. Touch sharing is covered by `tests/e2e/offerings-share.spec.ts`.
- `share-copied` disappears after about two seconds. Read the clipboard and capture proof immediately after the click.
