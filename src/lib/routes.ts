import { resolve } from "$app/paths";
import type { OfferingPlaceFilter } from "$lib/rpc/offerings.common";

export const routes = {
    root: () => resolve("/") as ResolvablePath,
    eventList: (args: { searchTerm?: string | null } = {}) => {
        const url = new URL(resolve("/"), BASE_URL);
        if (args.searchTerm) url.searchParams.set('searchTerm', args.searchTerm);
        return relativeUrl(url);
    },
    eventDetails: (slug: string) => resolve("/[slug]", { slug }) as ResolvablePath,
    sources: () => resolve(`/sources`) as ResolvablePath,
    about: () => resolve(`/about`) as ResolvablePath,
    faq: () => resolve(`/faq`) as ResolvablePath,
    newEvent: () => resolve(`/new`) as ResolvablePath,
    offeringsList: (filter?: OfferingPlaceFilter) => {
        const url = new URL(resolve(`/offerings`), BASE_URL);
        if (filter) url.searchParams.set('place', filter);
        return relativeUrl(url) as ResolvablePath;
    } ,
    newOffering: () => resolve(`/offerings/new`) as ResolvablePath,
    offeringDetails: (slug: string) => resolve(`/offerings/[id]`, { id: slug }) as ResolvablePath,
    editOffering: (slug: string) => resolve(`/offerings/[id]/edit`, { id: slug }) as ResolvablePath,
    profile: () => resolve(`/profile`) as ResolvablePath,
    myOfferings: () => resolve(`/profile/offerings`) as ResolvablePath,
    publicProfile: (slug: string) => resolve(`/@/[slug]`, { slug }) as ResolvablePath,
    editPublicProfile: () => resolve(`/profile/public`) as ResolvablePath,
    editEvent: (id: number, hostSecret?: string) => {
        const url = new URL(resolve(`/edit/[id]`, { id: id.toString() }), BASE_URL);
        if (hostSecret) {
            url.searchParams.set('hostSecret', hostSecret);
            url.searchParams.set('_ADMIN_LINK_NICHT_TEILEN', '');
        }
        return relativeUrl(url) as ResolvablePath;
    },
    favorites: () => resolve(`/profile/favorites`) as ResolvablePath,
}

export const BASE_URL = "https://blissbase.app" as const

export function absoluteUrl(path: string) {
    return new URL(path, BASE_URL).toString();
}

function relativeUrl(url: URL) {
    return url.toString().replace(url.origin, '')
}

type ResolvablePath = `/${string}` & {}; // to trick svelte into not complaining about not using resolve()