import type { Cookies } from '@sveltejs/kit';

const COOKIE_NAME = 'blissbase_filters';
const COOKIE_OPTIONS = {
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: false,
    secure: false,
    sameSite: 'lax' as const
};

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
};

/**
 * Validates and sanitizes filter data from cookies
 * @param data - Raw data from cookie
 * @returns Validated filter data or null if invalid
 */
function validateFilterData(data: unknown): FilterCookieData | null {
    if (!data || typeof data !== 'object') return null;

    const filterData = data as Record<string, unknown>;

    // Validate and convert lat/lng to numbers if they exist
    const lat = filterData.lat !== undefined && filterData.lat !== null
        ? Number(filterData.lat)
        : null;
    const lng = filterData.lng !== undefined && filterData.lng !== null
        ? Number(filterData.lng)
        : null;

    // Check if lat/lng are valid numbers
    if ((lat !== null && isNaN(lat)) || (lng !== null && isNaN(lng))) {
        return null;
    }

    // Validate tagIds array
    const tagIds = Array.isArray(filterData.tagIds)
        ? filterData.tagIds.filter((id): id is number => typeof id === 'number' && !isNaN(id))
        : null;

    return {
        startDate: typeof filterData.startDate === 'string' ? filterData.startDate : null,
        endDate: typeof filterData.endDate === 'string' ? filterData.endDate : null,
        plzCity: typeof filterData.plzCity === 'string' ? filterData.plzCity : null,
        distance: typeof filterData.distance === 'string' ? filterData.distance : null,
        lat,
        lng,
        searchTerm: typeof filterData.searchTerm === 'string' ? filterData.searchTerm : null,
        sortBy: typeof filterData.sortBy === 'string' ? filterData.sortBy : null,
        sortOrder: typeof filterData.sortOrder === 'string' ? filterData.sortOrder : null,
        tagIds: tagIds?.length ? tagIds : null
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