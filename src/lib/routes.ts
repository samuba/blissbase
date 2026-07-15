import { resolve } from "$app/paths";
import type { OfferingsFilter } from "$lib/offeringsFilter";
import { buildOfferingsFilterSearchParams } from "$lib/offeringsFilter";

export const routes = {
    root: () => resolve("/") ,
    eventList: (args: { searchTerm?: string | null } = {}) => {
        const url = new URL(resolve("/"), BASE_URL);
        if (args.searchTerm) url.searchParams.set('searchTerm', args.searchTerm);
        return relativeUrl(url);
    },
    eventDetails: (slug: string) => resolve("/[slug]", { slug }) ,
    sources: () => resolve(`/sources`) ,
    about: () => resolve(`/about`) ,
    faq: () => resolve(`/faq`) ,
    newEvent: () => resolve(`/events/new`) ,
    createHub: () => resolve(`/new`) ,
    offeringsList: (args: Partial<OfferingsFilter> = {}) => {
        const url = new URL(resolve(`/offerings`), BASE_URL);
        const params = buildOfferingsFilterSearchParams({
            location: args.location ?? null,
            distance: args.distance ?? null,
            lat: args.lat ?? null,
            lng: args.lng ?? null,
            searchTerm: args.searchTerm ?? null,
            includeOnline: args.includeOnline ?? false,
        });
        for (const [key, value] of params.entries()) {
            url.searchParams.set(key, value);
        }
        return relativeUrl(url) ;
    } ,
    currentPath: (url: URL) => `${url.pathname}${url.search}${url.hash}` ,
    newOffering: (args: ReturnToArgs = {}) => withReturnTo(resolve(`/offerings/new`) , args.returnTo),
    offeringDetails: (slug: string) => resolve(`/offerings/[id]`, { id: slug }) ,
    editOffering: (slug: string, args: ReturnToArgs = {}) => withReturnTo(resolve(`/offerings/[id]/edit`, { id: slug }) , args.returnTo),
    profile: () => resolve(`/profile`) ,
    myOfferings: () => resolve(`/profile/offerings`) ,
    publicProfile: (slug: string) => resolve(`/@/[slug]`, { slug }) ,
    editPublicProfile: () => resolve(`/profile/public`) ,
    editEvent: (id: number, hostSecret?: string) => {
        const url = new URL(resolve(`/edit/[id]`, { id: id.toString() }), BASE_URL);
        if (hostSecret) {
            url.searchParams.set('hostSecret', hostSecret);
            url.searchParams.set('_ADMIN_LINK_NICHT_TEILEN', '');
        }
        return relativeUrl(url) ;
    },
    favorites: () => resolve(`/profile/favorites`) ,
}

export const BASE_URL = "https://blissbase.app" as const
export const OFFERING_SLUG_QUERY = `offeringSlug` as const
export const EVENT_SLUG_QUERY = `eventSlug` as const

export function absoluteUrl(path: string) {
    return new URL(path, BASE_URL).toString();
}

const RESERVED_OFFERING_DETAIL_SLUGS = new Set([`new`]);

/** Returns the offering slug when the URL is `/offerings/{slug}` (not list, new, or nested edit). */
export function parseOfferingDetailsSlugFromUrl(url: URL) {
    const pathname = url.pathname.replace(/\/+$/, ``) || `/`;
    const prefix = `/offerings/`;
    if (!pathname.startsWith(prefix)) return null;

    const rest = pathname.slice(prefix.length);
    if (!rest || rest.includes(`/`)) return null;

    const slug = decodeURIComponent(rest);
    if (!slug || RESERVED_OFFERING_DETAIL_SLUGS.has(slug)) return null;
    return slug;
}

/** Appends `offeringSlug` so host pages can reopen the offering dialog after navigation. */
export function withOfferingSlug(args: { path: string; offeringSlug: string }) {
    const path = normalizeReturnToPath(args.path, BASE_URL) ?? routes.offeringsList();
    const url = new URL(path, BASE_URL);
    url.searchParams.set(OFFERING_SLUG_QUERY, args.offeringSlug);
    return relativeUrl(url);
}

/** Reads and removes `offeringSlug` from `url` (mutates search params). */
export function takeOfferingSlugQuery(url: URL) {
    const offeringSlug = url.searchParams.get(OFFERING_SLUG_QUERY)?.trim();
    if (!offeringSlug) return null;

    url.searchParams.delete(OFFERING_SLUG_QUERY);
    return offeringSlug;
}

/** Home (or other host) URL that opens the event details dialog after load. */
export function withEventSlug(args: { path?: string; eventSlug: string }) {
    const path = normalizeReturnToPath(args.path ?? routes.root(), BASE_URL) ?? routes.root();
    const url = new URL(path, BASE_URL);
    url.searchParams.set(EVENT_SLUG_QUERY, args.eventSlug);
    return relativeUrl(url);
}

/** Reads and removes `eventSlug` from `url` (mutates search params). */
export function takeEventSlugQuery(url: URL) {
    const eventSlug = url.searchParams.get(EVENT_SLUG_QUERY)?.trim();
    if (!eventSlug) return null;

    url.searchParams.delete(EVENT_SLUG_QUERY);
    return eventSlug;
}

export function safeReturnToPath(args: { returnTo?: string | null; fallback: string; origin?: string }) {
    const returnTo = normalizeReturnToPath(args.returnTo, args.origin ?? BASE_URL);
    return returnTo ?? args.fallback;
}

function relativeUrl(url: URL) {
    return url.toString().replace(url.origin, '')
}

function withReturnTo(path: ResolvedPathname, returnTo?: string | null) {
    const returnToPath = normalizeReturnToPath(returnTo, BASE_URL);
    if (!returnToPath) return path;

    const url = new URL(path, BASE_URL);
    url.searchParams.set(`returnTo`, returnToPath);
    return relativeUrl(url) ;
}

function normalizeReturnToPath(value: string | null | undefined, origin: string) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.startsWith(`//`)) return null;

    try {
        const url = new URL(trimmed, origin);
        if (url.origin !== origin) return null;

        return `${url.pathname}${url.search}${url.hash}` ;
    } catch {
        return null;
    }
}

type ReturnToArgs = { returnTo?: string | null };

type ResolvedPathname = ReturnType<typeof resolve>;