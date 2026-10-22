# Create Party registration, and the Blissbase port

Inspected on 22 Oct 2026. `github.com/samuba/create.party` returns 404 to this environment (private or renamed; `gh` is signed in as the Blissbase app and cannot see it), so this map is from the running product at `https://create.party`, not from a local clone.

Sources:

- Changelog at `/changelog` (German, 2024-01 through 2024-12).
- Public events API `GET /api/public-events` and its doc.
- SvelteKit page data for `/e/lukes-geburtstagsparty-e663b`, `/e/ecstatic-frequency-eeb46`, and `/e/wintergrillen-c043e`.
- Production client bundles for release `29952dfd8d5b6c3ba593402b856c3b5566f72d88`. The bundles embed telefunc paths such as `src/routes/(normal_layout)/e/[slug]/page.telefunc.ts`.
- Rendered HTML for the same events (which buttons and guest counts actually appear).

Running the repo locally was not possible without the source.

## Guest sign-up

Private events show three actions: **Going**, **Maybe**, **Can't go**. Each opens one dialog.

Public events (`isPublic`) show only **Register** (`data-testid="attend-btn"`). There is no Maybe and no upfront Can't go. Confirmed on `ecstatic-frequency-eeb46` and `wintergrillen-c043e`. Inside the dialog the decline radio is relabelled **Unregister** and still submits `NOT_ATTENDING`.

The dialog (`setMeAsAttending` / `setMeAsMaybeAttending` / `setMeToWaitlist` / `setMeAsNotAttending`) collects:

| Field            | Rules                                                                                                                           | Notes                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name             | Required, must contain a non-space character, maxlength 40. Label "First + Last Name". `autocomplete="name"`.                   | Not checked for two words.                                                                                                                                              |
| Companions       | Optional checkbox, then one name input per companion (maxlength 40). Host can turn the whole feature off (`companionsEnabled`). | Public events default this off.                                                                                                                                         |
| Bringing list    | Optional checkbox, then item names. Host can turn it off (`bringItemsEnabled`).                                                 | Public events default this off.                                                                                                                                         |
| Contact channel  | Select: SMS, Email, or "I don't want updates".                                                                                  | Host setting `requiredGuestContact`: `none` (default), `phone`, `email`, `phone_or_email`. When required, the "no updates" option disappears and the channel is forced. |
| Phone or email   | Shown for the chosen channel. Contact details maxlength 200.                                                                    | Copy warns that skipping updates means you miss cancellation and changes.                                                                                               |
| Custom questions | Only for Going, Maybe, and Waitlist. Not for decline.                                                                           | See below.                                                                                                                                                              |
| Comment          | Optional, maxlength 200. Placeholder like "Will arrive after 10pm".                                                             | Visibility hint follows the guest-list setting: everyone / other guests / hosts.                                                                                        |
| PayPal           | Out of scope. Shown when a price and PayPal username are set. Guest confirms `payedAllegedly`.                                  |                                                                                                                                                                         |

Decline / unregister sends only name and comment.

After a response, the page shows the guest's state and a **change** button (`change-attending-btn`) that reopens the dialog. A guest with no saved name who dismisses the dialog triggers `removeMe`.

## Custom questions

Host copy: "What else do you want to know from your guests? You can find the guests' answers in the table view."

Per question:

- Text (required to save). Placeholder "Do you need a place to sleep?"
- Optional explanation, shown under the question. Placeholder "So we can organize enough sleeping places."
- **Must be answered** (`mandatory`).
- Optional predefined answers. When the list is non-empty, guests can only pick those answers.
- **Multiple answers allowed** (`multipleAnswers`), only meaningful with predefined answers. UI is checkboxes. A single predefined answer is a `<select>`. Free text is an input, maxlength 3000.
- `order` integer. The form renders questions in that order.

Zod shape from the event editor bundle:

```text
{ id?, text, description?, mandatory, order, possibleAnswers: string[], multipleAnswers }
```

Live example (Luke's party):

1. "Sith oder Jedi?" mandatory, single choice, answers Jedi / Sith, description "Für die Sitzordnung".
2. "Von welchem Planeten kommst du?" optional free text.

Live public example (`ecstatic-frequency`): one mandatory multi-select ("Yin Yoga", "Ecstatic Dance + Kakaozeremonie", "Kuschelworkshop").

Submit payload:

```text
answers: { questionId, answer }[]
```

`answer` is a string, or an array of strings when multiple answers are allowed. The host table reads `guest.answers[questionId]`. Answers are not shown on the public guest list. They appear in the host table view and the Excel-equivalent export, one column per question text, plus a sheet with questions as rows and guests as columns.

## Who the guest is

No account is required to open an event. The first response sets a signed `userid` cookie (anonymous user id plus signature). `setCurrentUser` stores the typed name on that user. A separate optional login (`/auth/login`) links `authUserId`.

A guest row is keyed by `userId`, not by email. Email and phone are contact fields and can be null. Public payloads include `name`, `user.id`, `avatarUrl`, `attending`, `companions`, `comment`, `createdAt`. On the samples, `email`, `phone`, `answers`, `paidAllegedly`, and `contactPreference` were null for anonymous viewers. `wintergrillen` (`guests_count_public`) returned guest rows with `name: null`, so the server strips names the viewer must not see rather than only hiding them in the client.

`attending` is `ATTENDING`, `MAYBE`, `NOT_ATTENDING`, `WAITLIST`, or `UNKNOWN`.

## Cancel and decline

- Private events: **Can't go** stores `NOT_ATTENDING` via `setMeAsNotAttending`. The guest stays in the "not coming" section when the list is visible.
- Public events: the same radio is labelled **Unregister** and still stores `NOT_ATTENDING`. There is no separate delete on that path.
- `removeMe` / `removeGuest` exist. `removeMe` runs when the dialog is cancelled and the user still has no name. Hosts can remove a guest from the guest-list editor (`guest-list-edit-remove-btn`).
- Hosts can also add a guest, change attending, and move someone between the list and the waitlist.

## Capacity and waitlist

- `maxGuests` (integer, at least 1, or empty for no limit).
- When `maxGuests` is set and `guests.length >= maxGuests`, the client treats the event as full. The submit button becomes **Add to waitlist** and calls `setMeToWaitlist`, unless the person is already attending or is declining.
- The client compares the raw guest array length, not companions. The number shown on the page is attending guests plus their companions.
- `waitlistAutoMoveUp` defaults to true. When someone drops out, the next waitlist guest is moved up and notified. The host can turn auto-move off and can move someone up by hand (`moveUpWaitlistEntry`).
- Waitlist is visible in the guest list and in its own sheet of the table view when a limit is set.
- Full-event copy: "Sorry, the event is already full" plus "you've been added to the waitlist and will be contacted when a spot becomes available."

## Notifications

- Contact channel is how the guest hears about **this event only** (cancellation, important changes, waitlist promotion). SMS or email. Opting out is allowed unless the host required a channel.
- Waitlist promotion notifies the guest.
- Hosts can broadcast a message to all guests (`sendBroadcast`), pin one on the event, and delete the pin.
- Deleting an event emails and SMSes guests (changelog).
- Table view and Excel export are the host's record. This map did not find a separate "email the host on every RSVP" feature.

## Host view of registrations

On the event, hosts see an edit link, a table button (`event-table-btn`), and a guest-list editor.

Table sheets:

- Guests (everyone except waitlist): name, attending label, companions, paid-allegedly, comment, one column per question, contact (email or phone), created time. Newest first.
- Waitlist, inserted only when `maxGuests` is set. Same idea, without the attending column.
- Questions as rows, guests as columns, plus the comment row.
- Bringing list.
- Event summary counts (coming / maybe / not coming / visitors).

The guest-list editor can change attending, add a guest (name required, attending required), remove a guest, and promote from the waitlist.

## Guest list visibility

Host question: "Who can see guest names?"

| Value                 | Label                                   | Names                                         | Count       |
| --------------------- | --------------------------------------- | --------------------------------------------- | ----------- |
| `public` (default)    | Everyone                                | Everyone                                      | Everyone    |
| `guests`              | Only guests                             | Hosts, plus guests who are attending or maybe | Same people |
| `guests_count_public` | Only guests + everyone sees guest count | Hosts, plus attending or maybe guests         | Everyone    |
| `owners`              | Only hosts                              | Hosts                                         | Hosts       |
| `owners_count_public` | Only hosts + everyone sees guest count  | Hosts                                         | Everyone    |

Waitlist and declined guests do **not** count as "guests" for the guests-only name rule. Only `ATTENDING` and `MAYBE`.

The header count is hidden when the viewer cannot see the count. `owners` on `ecstatic-frequency` rendered no guest count and no "show" button. `guests_count_public` on `wintergrillen` rendered the count `2` and no "show" button. When names are allowed, a **show** button (`open-guest-list-btn`) opens sections for registered, maybe, not coming, and waitlist. Comments are included for whoever can see names. The comment field's hint switches with the same three groups (everyone / other guests / hosts).

Turning an event public forces `guestVisibility` to `guests_count_public` and turns companions and the bringing list off. The host can change visibility afterwards.

## Other registration-related behaviour (not all ported)

- Anonymous cookie identity, optional account login, avatars.
- Multiple hosts (`owners`), public host profiles.
- Bringing list with attribution ("by Name").
- Companions counted in the public attending total.
- Photos uploaded by guests and hosts.
- Pinned broadcasts.
- Visitors counter (`addMeAsVisitor`).
- Clone event, private vs public event type.
- Flexible min/max price and box office.
- PayPal username, "I paid" confirmation, host column "Paid (allegedly)". The product cannot verify PayPal.
- Admin link that must not be shared with guests.
- Excel export and in-page table view are the same data.

## Blissbase domain and architecture

Blissbase events already have a host (`authorId` or `hostSecret`), Supabase sign-in, and German event pages. Scraped events keep the external "Jetzt Buchen" path. Registration is off until the host turns it on, so existing events do not change.

Registration is a separate remote API (`src/lib/rpc/registration.remote.ts`). It is not folded into the create/update event form, so the create flow and scrapers stay as they are. Listing queries do not load registrations.

### Tables (`src/lib/server/schema.ts`)

On `events`:

- `registrationEnabled` boolean, default false.
- `guestListVisibility` enum: `public`, `guests`, `owners`, `guests_count_public`, `owners_count_public`. Default `public`.
- `maxGuests` integer, null means no limit.
- `waitlistAutoMoveUp` boolean, default true.

`registration_questions`: event, text, description, mandatory, sort order, possible answers, multiple answers.

`registrations`: one row per event and user. Name, email, comment, status `registered` | `waitlist` | `cancelled`.

`registration_answers`: registration, question, jsonb answer (`string` or `string[]`).

This repo does not commit SQL migrations. Schema is applied by the PGlite test setup from `schema.ts`. Production needs the usual manual migration. Do not `drizzle-kit push` or `drizzle-kit migrate` from an agent.

### Pure rules (`src/lib/registration.ts`)

Tested without a database:

- Name, email, comment, and answer validation (same limits as Create Party: name 40, comment 200, free-text answer 3000).
- Question normalisation: order is the list order, blank predefined answers drop, duplicates rejected, multiple-answers forced off when there is no list.
- Seat rule: a new or previously cancelled guest becomes `registered` until `maxGuests` registered people exist, then `waitlist`. Someone already registered or waitlisted keeps that status when they edit answers. Registered people are the only seats. Waitlist and cancelled do not take a seat.
- Cancelling a registered guest promotes the oldest waitlist row when auto-move is on. Cancelling a waitlist row promotes nobody.
- Visibility matrix above. "Guest" means status `registered` (Create Party's attending/maybe). Waitlist does not unlock a guests-only list. Hosts (author, matching `hostSecret`, or admin) always see names, count, emails, and answers.

`buildRegistrationView` is what the page receives. Emails and answers of other people are omitted unless the viewer is a host. Counts are omitted when the viewer must not see them, so they are not only hidden in CSS.

### UI

- Event page, only when registration is enabled or the viewer is the author: **Anmelden** opens the form. Signed-out visitors get the existing login dialog first.
- Signed-in guests with an active registration can change answers and **Abmelden**.
- Guest list (names and/or count) follows the visibility setting.
- Host block on the event page and on the edit page: enable registration, visibility, limit, auto-move, questions, and the registration table.

Identity is the Blissbase user id. Name and email are stored on the registration (prefilled from the profile and session email) so the host keeps what was submitted.

### Emails

Resend, same helper as event-created mail. The guest is mailed when they register, when they land on the waitlist, when they are promoted, and when they cancel. `@example.com` is skipped, same as other mail. Mail failure does not fail the registration. There is no SMS.

## Intentionally not ported

| Create Party                                           | Why                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PayPal, price confirmation, "paid allegedly"           | Explicitly out of scope.                                                                                                                                                                                                |
| Maybe                                                  | Explicitly out of scope.                                                                                                                                                                                                |
| Upfront decline button                                 | Explicitly out of scope. Public Create Party events already only show Register. Cancel after sign-in is **Abmelden**, which marks the row `cancelled` and frees the seat. It does not leave a public "can't go" roster. |
| Anonymous cookie users                                 | Blissbase guests are signed-in users.                                                                                                                                                                                   |
| Phone / SMS contact channel and `requiredGuestContact` | The Blissbase form always asks for email, which is the account channel.                                                                                                                                                 |
| Companions and the bringing list                       | Separate from the sign-up questions. They change capacity math and the public list. Left out so one registration is one seat.                                                                                           |
| Guest photos, pinned broadcasts, visitor counter       | Not registration.                                                                                                                                                                                                       |
| Host broadcast to all guests                           | Needs a messaging product. Promotion and the guest's own status are emailed instead.                                                                                                                                    |
| Excel export and the spreadsheet table                 | The host list on the event shows the same facts (name, email, status, comment, answers).                                                                                                                                |
| Host manually adds, edits, or removes another guest    | Hosts can read every registration. They do not impersonate guests.                                                                                                                                                      |
| Multiple hosts                                         | Blissbase already has author plus `hostSecret`.                                                                                                                                                                         |
| Forcing visibility when an event is "public"           | Blissbase events are already public listings. The host picks visibility directly. Default remains everyone.                                                                                                             |
| Delete-event SMS/email fan-out                         | Event delete already exists and was not part of this change.                                                                                                                                                            |
