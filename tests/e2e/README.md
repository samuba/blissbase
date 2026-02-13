# Blissbase E2E Tests

This directory contains end-to-end tests for the Blissbase application using Playwright.

## Setup

1. Install dependencies:
```bash
bun install
```

2. Install Playwright browsers:
```bash
bunx playwright install chromium
```

3. Create a `.env` file with required environment variables:
```bash
DATABASE_URL=file:local.db
GOOGLE_MAPS_API_KEY=test-api-key-for-e2e-tests
PUBLIC_SUPABASE_URL=https://test.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-publishable-key
PUBLIC_ADMIN_USER_ID=test-admin-id
TELEGRAM_BOT_TOKEN=test-telegram-token
S3_ACCESS_KEY_ID=test-s3-key
S3_SECRET_ACCESS_KEY=test-s3-secret
S3_BUCKET_NAME=test-bucket
CLOUDFLARE_ACCOUNT_ID=test-account-id
ADMIN_SECRET=test-admin-secret
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
- `filters.spec.ts` - Tests for filter modal functionality (time period, distance, attendance, sorting)
- `event-details.spec.ts` - Tests for event detail modal and navigation

## Test Data Attributes

The tests rely on `data-testid` attributes in the components:

- `data-testid="event-card"` - Event card components
- `data-testid="event-details"` - Event details modal
- `data-testid="event-location"` - Event location display
- `data-testid="favorite"` - Favorite button
- `data-testid="tag"` - Category tags
- `data-testid="loading"` - Loading indicators

## CI/CD

The tests run automatically on GitHub Actions for pull requests and pushes to main.

See `.github/workflows/e2e-tests.yml` for the CI configuration.

## Writing New Tests

1. Use `test.describe()` to group related tests
2. Use `test.beforeEach()` for common setup
3. Use page locators with semantic selectors
4. Add `data-testid` attributes to components for reliable selection
5. Handle both success and error states

Example:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
  });

  test('should do something', async ({ page }) => {
    // Test code here
  });
});
```
