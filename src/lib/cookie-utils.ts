import type { Cookies } from '@sveltejs/kit';
import { sanitizeLocationParams } from '$lib/locationFilter';
import type { AttendanceMode } from './server/schema';

const COOKIE_NAME = 'blissbase_filters';
export const LOCATION_INTERACTED_COOKIE_NAME = 'blissbase_location_set';
const COOKIE_OPTIONS = {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    httpOnly: false,
    secure: false,
    sameSite: 'lax' as const
};
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

export type FilterCookieData = {
    startDate?: string | null;
    endDate?: string | null;
    plzCity?: string | null;
    distance?: string | null;
    lat?: number | null;
    lng?: number | null;
    searchTerm?: string | null;
    sortBy?: string | null;
    sortOrder?: string | null;
    tagIds?: number[] | null;
    attendanceMode?: AttendanceMode | null;
};

/**
 * Validates and sanitizes filter data from cookies
 * @param data - Raw data from cookie
 * @returns Validated filter data or null if invalid
 */
export function validateFilterData(data: unknown): FilterCookieData | null {
    if (!data || typeof data !== 'object') return null;

    const filterData = data as Record<string, unknown>;

    // Validate tagIds array
    const tagIds = Array.isArray(filterData.tagIds)
        ? filterData.tagIds.filter((id): id is number => typeof id === 'number' && !isNaN(id))
        : null;

    const location = sanitizeLocationParams({
        plzCity: typeof filterData.plzCity === 'string' ? filterData.plzCity : null,
        distance: typeof filterData.distance === 'string' ? filterData.distance : null,
        lat: filterData.lat !== undefined && filterData.lat !== null ? Number(filterData.lat) : null,
        lng: filterData.lng !== undefined && filterData.lng !== null ? Number(filterData.lng) : null
    });

    if (
        (filterData.lat !== undefined && filterData.lat !== null && isNaN(Number(filterData.lat))) ||
        (filterData.lng !== undefined && filterData.lng !== null && isNaN(Number(filterData.lng)))
    ) {
        return null;
    }

    return {
        startDate: typeof filterData.startDate === 'string' ? filterData.startDate : null,
        endDate: typeof filterData.endDate === 'string' ? filterData.endDate : null,
        plzCity: location.plzCity,
        distance: location.distance,
        lat: location.lat,
        lng: location.lng,
        searchTerm: typeof filterData.searchTerm === 'string' ? filterData.searchTerm : null,
        sortBy: typeof filterData.sortBy === 'string' ? filterData.sortBy : null,
        sortOrder: typeof filterData.sortOrder === 'string' ? filterData.sortOrder : null,
        tagIds: tagIds?.length ? tagIds : null,
        attendanceMode: typeof filterData.attendanceMode === 'string' ? filterData.attendanceMode as AttendanceMode : null
    };
}

/**
 * Saves filter parameters to a cookie for persistence
 * @param cookies - SvelteKit cookies object
 * @param filters - Filter data to save
 */
export function saveFiltersToCookie(cookies: Cookies, filters: FilterCookieData) {
    try {
        const cookieData = JSON.stringify(filters);
        cookies.set(COOKIE_NAME, cookieData, COOKIE_OPTIONS);
    } catch (error) {
        console.error('Failed to save filters to cookie:', error);
    }
}

/**
 * Loads filter parameters from a cookie
 * @param cookies - SvelteKit cookies object
 * @returns Filter data or null if not found/invalid
 */
export function loadFiltersFromCookie(cookies: Cookies): FilterCookieData | null {
    try {
        const cookieValue = cookies.get(COOKIE_NAME);
        if (!cookieValue) return null;

        const parsed = JSON.parse(cookieValue);
        return validateFilterData(parsed);
    } catch (error) {
        console.error('Failed to load filters from cookie:', error);
        return null;
    }
}

/**
 * Clears the filters cookie
 * @param cookies - SvelteKit cookies object
 */
export function clearFiltersCookie(cookies: Cookies) {
    cookies.delete(COOKIE_NAME, { path: '/' });
}

/**
 * Marks that the user manually interacted with location controls.
 * Once set, server-side auto-location detection should not run again.
 */
export function setLocationInteractedCookie() {
    if (typeof document === 'undefined') return;
    document.cookie = `${LOCATION_INTERACTED_COOKIE_NAME}=1; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`;
}

export function loadFiltersFromBrowserCookie(): FilterCookieData | null {
    if (typeof document === 'undefined') return null;

    const cookiePrefix = `${COOKIE_NAME}=`;
    const rawCookie = document.cookie
        .split(`;`)
        .map((part) => part.trim())
        .find((part) => part.startsWith(cookiePrefix));
    if (!rawCookie) return null;

    try {
        const value = decodeURIComponent(rawCookie.slice(cookiePrefix.length));
        return validateFilterData(JSON.parse(value));
    } catch {
        return null;
    }
}

export function saveLocationFiltersToBrowserCookie(filters: Pick<FilterCookieData, 'plzCity' | 'distance' | 'lat' | 'lng'>) {
    if (typeof document === 'undefined') return;

    const next = {
        ...(loadFiltersFromBrowserCookie() ?? {}),
        plzCity: filters.plzCity,
        distance: filters.distance,
        lat: filters.lat,
        lng: filters.lng,
    };

    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`;
}