# Blissbase E2E Tests

This directory contains end-to-end tests for the Blissbase application using Playwright.

## Architecture

- **Database**: Each Playwright worker starts its own Vite server with an in-memory PGlite database
- **Ports**: Workers bind distinct ports (`5174 + workerIndex`, skipping taken ports)
- **Auth / cookies / storage**: Each test gets a fresh browser context. Cookies are scoped to that worker's origin. Do not share `storageState` files.
- **Auth flow**: Signed-in tests use E2E cookies. Anonymous offering tests use a dev/E2E-only fixed OTP (`123456`) while still exercising the server verification and submit-token flow.
- **External Services**: Google Maps API, S3, and other services use test/mock values

Import `test` and `expect` from `./helpers/fixtures` (not `@playwright/test`) so the worker server and DB reset run.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Install Playwright browsers:

```bash
bunx playwright install chromium
```

3. Create a `.env` file (optional - E2E tests work with defaults):

```bash
# Only needed if you want to override defaults
GOOGLE_MAPS_API_KEY=your-api-key
PUBLIC_SUPABASE_URL=your-supabase-url
PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-key
```

## Running Tests

### Run all E2E tests (parallel workers, isolated servers):

```bash
bun run test:e2e
```

Local default is 3 workers. CI uses 2 workers per shard.

### Force a worker count:

```bash
PLAYWRIGHT_WORKERS=2 bun run test:e2e
```

### Run one shard (as CI does):

```bash
bun run test:e2e -- --shard=1/2
```

### Run tests with UI mode (for debugging):

```bash
bun run test:e2e:ui
```

### Run specific test file:

```bash
bun run test:e2e -- homepage.spec.ts
```

### Run tests matching a pattern:

```bash
bun run test:e2e -- --grep "filter modal"
```

### Debug mode (single worker):

```bash
bun run test:e2e:debug
```

### Serial run (same isolation, no parallelism):

```bash
PLAYWRIGHT_WORKERS=1 bun run test:e2e
```

## Test Files

- `homepage.spec.ts` - Tests for homepage features (hero, search, category filters, event cards)
- `filters.spec.ts` - Tests for filter modal functionality
- `event-details.spec.ts` - Tests for event detail modal and navigation
- `edit-event-images.spec.ts` - Tests event image editing
- `location-autocomplete.spec.ts` - Tests the Google Places autocomplete UI
- `location-filtering.spec.ts` - Tests location chip filtering, cookie prefill, GPS, and unknown places
- `offerings-create.spec.ts` - Tests signed-in and anonymous offering creation, validation, OTP, profile completion, and images
- `offerings-discovery.spec.ts` - Tests offering eligibility, search, location/online filters, dialogs, and return navigation
- `offerings-lifecycle.spec.ts` - Tests edit permissions, image editing, activation, deactivation, owner visibility, and deletion
- `helpers/fixtures.ts` - Per-worker Vite/PGlite server and DB reset
- `helpers/seed.ts` - Test data seeding utilities

## Test Data

Tests use the `/api/test/seed` endpoint to create isolated test data:

```typescript
import { createEvent, clearTestEvents, createMeditationEvent } from "./helpers/seed";

// In test setup:
await clearTestEvents(page);
await createEvent(page, createMeditationEvent());
```

Available factory functions:

- `createMeditationEvent(overrides?)` - Creates a meditation event
- `createYogaEvent(overrides?)` - Creates a yoga event
- `createOnlineEvent(overrides?)` - Creates an online event
- `createMultiDayEvent(overrides?)` - Creates a multi-day event
- `createCompleteProfile(overrides?)` / `createOtherCompleteProfile(overrides?)` - Create owner fixtures
- `createOfflineOffering(overrides?)` / `createOnlineOffering(overrides?)` - Create offering fixtures

Offering tests seed matching profile IDs before using `signInAsE2EUser`. All profile, offering, OTP, and image-upload shortcuts are gated by both development/E2E routes or `E2E_TEST`, so production behavior is unchanged.

## How It Works

1. **Per-worker Vite**: `helpers/fixtures.ts` starts `bun run dev` with `E2E_TEST=true`, a unique port, Vite cache dir, and SvelteKit outDir. HMR and PWA are off so workers do not fight over the same `.svelte-kit` / dep cache.
2. **PGlite**: Each of those servers has its own in-memory database.
3. **DB reset**: Every test wipes favorites, offerings, events, and profiles before and after via `resetDatabase`.
4. **Test seeding**: Each test creates its own data via the seed API.
5. **No Docker**: No external dependencies needed for local test runs

## CI/CD

Tests run automatically on GitHub Actions for pull requests. The workflow:

1. Runs unit tests first
2. Then runs E2E as two shards, each with 2 isolated workers
3. Uploads per-shard Playwright reports

See `.github/workflows/e2e-tests.yml` for details.

## Writing New Tests

1. Import `test` / `expect` from `./helpers/fixtures`
2. Use `test.describe()` to group related tests
3. Use `test.beforeEach()` for common setup with seed data
4. Locate interactive elements via `data-testid` and `getByTestId()`. Do not find buttons, links, dialogs, inputs, or cards by visible text.
5. Handle CI slowness with appropriate timeouts

Example:

```typescript
import { expect, test } from "./helpers/fixtures";
import { createEvent, clearTestEvents, createMeditationEvent } from "./helpers/seed";

test.describe("Feature Name", () => {
	test.beforeEach(async ({ page }) => {
		await clearTestEvents(page);
		await createEvent(page, createMeditationEvent());
		await page.goto("/");
		await page.getByTestId("event-card").first().waitFor({ timeout: 15000 });
	});

	test.afterEach(async ({ page }) => {
		await clearTestEvents(page);
	});

	test("should do something", async ({ page }) => {
		// Test code here
	});
});
```
