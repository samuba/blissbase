import { resolve } from "$app/paths";
import type { OfferingPlaceFilter } from "$lib/rpc/offerings.common";

export const routes = {
    root: () => resolve("/"),
    eventList: (args: { searchTerm?: string | null } = {}) => {
        const url = new URL(resolve("/"), BASE_URL);
        if (args.searchTerm) url.searchParams.set('searchTerm', args.searchTerm);
        return relativeUrl(url);
    },
    eventDetails: (slug: string) => resolve("/[slug]", { slug }),
    sources: () => resolve(`/sources`),
    about: () => resolve(`/about`),
    faq: () => resolve(`/faq`),
    newEvent: () => resolve(`/new`),
    offeringsList: (filter?: OfferingPlaceFilter, selectedOfferingId?: number) => {
        const url = new URL(resolve(`/offerings`), BASE_URL);
        if (filter) url.searchParams.set('place', filter);
        if (selectedOfferingId) url.searchParams.set('offering', selectedOfferingId.toString());
        return relativeUrl(url);
    },
    newOffering: () => resolve(`/offerings/new`),
    offeringDetails: (id: number) => resolve(`/offerings/[id]`, { id: id.toString() }),
    editOffering: (id: number) => resolve(`/offerings/[id]/edit`, { id: id.toString() }),
    profile: () => resolve(`/profile`),
    myOfferings: () => resolve(`/profile/offerings`),
    publicProfile: (slug: string) => resolve(`/@/[slug]`, { slug }),
    editPublicProfile: () => resolve(`/profile/public`),
    editEvent: (id: number, hostSecret?: string) => {
        const url = new URL(resolve(`/edit/[id]`, { id: id.toString() }), BASE_URL);
        if (hostSecret) {
            url.searchParams.set('hostSecret', hostSecret);
            url.searchParams.set('_ADMIN_LINK_NICHT_TEILEN', '');
        }
        return relativeUrl(url);
    },
    favorites: () => resolve(`/profile/favorites`)
}

export const BASE_URL = "https://blissbase.app" as const

export function absoluteUrl(path: string) {
    return new URL(path, BASE_URL).toString();
}

function relativeUrl(url: URL) {
    return url.toString().replace(url.origin, '')
}
