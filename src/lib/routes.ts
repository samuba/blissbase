import { resolve } from "$app/paths";

export const routes = {
    root: () => resolve("/"),
    eventList: (args: { searchTerm?: string | null } = {}) => {
        const url = new URL(resolve("/"), BASE_URL);
        if (args.searchTerm) url.searchParams.set('searchTerm', args.searchTerm);
        return url.toString().replace(url.origin, '');
    },
    eventDetails: (slug: string) => resolve("/[slug]", { slug }),
    sources: () => resolve(`/sources`),
    about: () => resolve(`/about`),
    faq: () => resolve(`/faq`),
    newEvent: () => resolve(`/new`),
    profile: () => resolve(`/profile`),
    publicProfile: (slug: string) => resolve(`/@/[slug]`, { slug }),
    editPublicProfile: () => resolve(`/profile/public`),
    editEvent: (id: number, hostSecret?: string) => {
        const url = new URL(resolve(`/edit/[id]`, { id: id.toString() }), BASE_URL);
        if (hostSecret) {
            url.searchParams.set('hostSecret', hostSecret);
            url.searchParams.set('_ADMIN_LINK_NICHT_TEILEN', '');
        }
        return url.toString().replace(url.origin, '');
    },
    favorites: () => resolve(`/profile/favorites`)
}

export const BASE_URL = "https://blissbase.app" as const

export function absoluteUrl(path: string) {
    return new URL(path, BASE_URL).toString();
}