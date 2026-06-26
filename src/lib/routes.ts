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
    newEvent: () => resolve(`/new`) ,
    offeringsList: (args: Partial<OfferingsFilter> = {}) => {
        const url = new URL(resolve(`/offerings`), BASE_URL);
        const params = buildOfferingsFilterSearchParams({
            plzCity: args.plzCity ?? null,
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
    offeringDialog: (args: { returnTo: string; offeringSlug: string }) => {
        const returnToPath = normalizeReturnToPath(args.returnTo, BASE_URL) ?? routes.offeringsList();
        const url = new URL(returnToPath, BASE_URL);
        url.searchParams.set(`offering`, args.offeringSlug);
        return relativeUrl(url) ;
    },
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

export function absoluteUrl(path: string) {
    return new URL(path, BASE_URL).toString();
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