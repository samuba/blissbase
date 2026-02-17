# Blissbase E2E Tests

This directory contains end-to-end tests for the Blissbase application using Playwright.

## Architecture

- **Database**: E2E tests use PGlite (in-memory PostgreSQL) instead of a real database
- **Auth**: Supabase is still used for authentication (requires Supabase env vars)
- **External Services**: Google Maps API, S3, and other services use test/mock values

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

### Run all E2E tests:
```bash
bun run test:e2e
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

### Debug mode:
```bash
bun run test:e2e:debug
```

## Test Files

- `homepage.spec.ts` - Tests for homepage features (hero, search, category filters, event cards)
- `filters.spec.ts` - Tests for filter modal functionality
- `event-details.spec.ts` - Tests for event detail modal and navigation
- `helpers/seed.ts` - Test data seeding utilities

## Test Data

Tests use the `/api/test/seed` endpoint to create isolated test data:

```typescript
import { createEvent, clearTestEvents, createMeditationEvent } from './helpers/seed';

// In test setup:
await clearTestEvents(page);
await createEvent(page, createMeditationEvent());
```

Available factory functions:
- `createMeditationEvent(overrides?)` - Creates a meditation event
- `createYogaEvent(overrides?)` - Creates a yoga event
- `createOnlineEvent(overrides?)` - Creates an online event
- `createMultiDayEvent(overrides?)` - Creates a multi-day event

## How It Works

1. **PGlite Mode**: When `E2E_TEST=true`, the app uses PGlite (in-memory database)
2. **Test Seeding**: Each test creates its own data via the seed API
3. **Isolation**: Tests clean up after themselves in `afterEach`
4. **No Docker**: No external dependencies needed for local test runs

## CI/CD

Tests run automatically on GitHub Actions for pull requests. The workflow:
1. Runs unit tests first
2. Then runs E2E tests with PGlite
3. Uploads test results and artifacts on failure

See `.github/workflows/e2e-tests.yml` for details.

## Writing New Tests

1. Use `test.describe()` to group related tests
2. Use `test.beforeEach()` for common setup with seed data
3. Use page locators with semantic selectors
4. Handle CI slowness with appropriate timeouts

Example:
```typescript
import { test, expect } from '@playwright/test';
import { createEvent, clearTestEvents, createMeditationEvent } from './helpers/seed';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await clearTestEvents(page);
    await createEvent(page, createMeditationEvent());
    await page.goto('/');
    await page.waitForSelector('[data-testid="event-card"]', { timeout: 15000 });
  });

  test.afterEach(async ({ page }) => {
    await clearTestEvents(page);
  });

  test('should do something', async ({ page }) => {
    // Test code here
  });
});
```
