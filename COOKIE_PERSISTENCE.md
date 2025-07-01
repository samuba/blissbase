# Cookie Persistence for User Filters

This implementation saves user filter preferences in cookies so that when users return to the page, their previous filter settings are automatically applied. Cookie handling is done entirely server-side through Telefunc for better security and performance.

## How it works

### 1. Cookie Storage

- Filter parameters are saved to a cookie named `blissbase_filters`
- Cookie expires after 30 days
- Uses secure cookie settings with `SameSite=Lax`

### 2. Filter Parameters Saved

The following filter parameters are persisted:

- `startDate` - Start date for event search
- `endDate` - End date for event search
- `plzCity` - City/PLZ for location-based search
- `distance` - Distance radius for location search
- `lat` - Latitude coordinate
- `lng` - Longitude coordinate
- `searchTerm` - Search term for event names/descriptions
- `sortBy` - Sort field (time, distance)
- `sortOrder` - Sort direction (asc, desc)

### 3. Implementation Details

#### Server-side (Page Load)

- `src/routes/+page.server.ts` reads cookies on initial page load
- Applies saved filters to initial data fetch
- Returns saved filter state to client

#### Server-side (Filter Changes via Telefunc)

- `src/routes/page.telefunc.ts` handles all filter changes through `fetchEventsWithCookiePersistence`
- Cookies are automatically saved when filter parameters change
- Only saves on first page (not during infinite scroll pagination)
- Compares current params with saved params to avoid unnecessary cookie writes

#### Cookie Management

- `src/lib/cookie-utils.ts` provides utility functions for cookie operations
- Includes validation and sanitization of cookie data
- Handles type conversion for numeric values (lat/lng)

### 4. User Experience

#### Automatic Restoration

When a user returns to the page:

1. Saved filters are loaded from cookies on server-side page load
2. Events are fetched with the saved parameters
3. UI components reflect the saved state
4. User sees their previous search results

#### Filter Changes

When user changes any filter:

1. Telefunc call is made with new parameters
2. Server compares new params with saved params
3. If different, cookies are automatically updated
4. Events are fetched with new parameters

#### Clear All Filters

When user clicks "Clear All Filters":

1. All filters are reset to defaults via `loadEvents` call
2. Server automatically detects the parameter change
3. Cookie is updated with default values
4. Page refreshes with default parameters

### 5. Security & Privacy

- All cookie operations happen server-side
- No client-side cookie manipulation
- Cookies are validated and sanitized
- 30-day expiration ensures data doesn't persist indefinitely

### 6. Performance Benefits

- Cookie operations only happen when parameters actually change
- No unnecessary cookie writes during pagination
- Server-side validation prevents invalid data
- Reduced client-side JavaScript complexity
- No separate server actions needed for cookie management

### 7. Error Handling

- Graceful fallback to default parameters if cookie is invalid
- Console logging for debugging cookie issues
- Type validation prevents runtime errors
- Fallback to regular fetchEvents if cookies context is unavailable

## Files Modified

- `src/lib/cookie-utils.ts` - Utility functions for cookie operations
- `src/routes/+page.server.ts` - Initial page load with saved filters
- `src/routes/page.telefunc.ts` - Server-side cookie persistence in Telefunc
- `src/routes/_telefunc/+server.ts` - Passes cookies context to Telefunc
- `src/lib/eventsStore.svelte.ts` - Updated to use server-side cookie handling
- `src/lib/components/HeaderControls.svelte` - Simplified to use automatic cookie updates
