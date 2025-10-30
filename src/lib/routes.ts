export const BASE_URL = "https://blissbase.app" as const

export const routes = {
    eventList: (args: { searchTerm?: string | null } = {}) => {
        const url = new URL('/', BASE_URL);
        if (args.searchTerm) url.searchParams.set('searchTerm', args.searchTerm);
        return url.toString().replace(url.origin, '');
    },
    eventDetails: (slug: string, absolute: boolean = false) => {
        const url = new URL(`/${slug}`, BASE_URL);
        return absolute ? url.toString() : url.toString().replace(url.origin, '');
    },
    sources: () => '/sources',
    newEvent: () => '/new',
    editEvent: (id: number, hostSecret?: string, absolute: boolean = false) => {
        const url = new URL(`/edit/${id}`, BASE_URL);
        if (hostSecret) {
            url.searchParams.set('hostSecret', hostSecret);
            url.searchParams.set('_ADMIN_LINK_NICHT_TEILEN', '');
        }
        return absolute ? url.toString() : url.toString().replace(url.origin, '');
    },
    favorites: () => '/profile/favorites'
}
