import { db } from './db';
import { createGoogleCacheApi } from './google.shared';

export const { geocodeAddressCached, reverseGeocodeCityCached, getTimezoneForCoordinatesCached } = createGoogleCacheApi(db);
