import { page } from "$app/state";
import type { MetaTagsProps } from "svelte-meta-tags";

export function debounce(func: (...args: unknown[]) => void, wait: number) {
    let timeout: NodeJS.Timeout;
    return function executedFunction(...args: unknown[]) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export function formatTimeStr(start: Date | undefined, end: Date | undefined | null): string {
    if (!start) return 'Date TBD';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventStartDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());

    const diffTime = eventStartDay.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });

    let dateString: string;

    if (diffDays === 1 || diffDays === 0 || diffDays === -1) {
        const relativeDate = rtf.format(diffDays, 'day');
        // Capitalize first letter for German "Gestern", "Heute", "Morgen"
        dateString = relativeDate.charAt(0).toUpperCase() + relativeDate.slice(1);
    } else {
        dateString = start.toLocaleDateString('de-DE', { dateStyle: 'medium' });
    }

    let str = `${dateString}, ${start.toLocaleTimeString('de-DE', { timeStyle: 'short' })}`;

    if (end) {
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        const nextDayStart = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);

        // Check if end is on the same day as start OR if end is on the next day and before noon
        const endsOnSameDayOrBeforeNoonNextDay =
            startDay.getTime() === endDay.getTime() ||
            (endDay.getTime() === nextDayStart.getTime() && end.getHours() < 12);

        if (endsOnSameDayOrBeforeNoonNextDay) {
            // Only show end time
            str += ` – ${end.toLocaleTimeString('de-DE', { timeStyle: 'short' })}`;
        } else {
            // Show start date – end date (no times)
            str = dateString; // Initialize str with only the date string, removing the start time
            str += ` – ${end.toLocaleDateString('de-DE', { dateStyle: 'medium' })}`;
        }
    }
    return str;
}

export function formatAddress(address: string[]): string {
    const bundeslaender = [
        'Bayern',
        'Baden-Württemberg',
        'Brandenburg',
        'Hessen',
        'Mecklenburg-Vorpommern',
        'Niedersachsen',
        'Nordrhein-Westfalen',
        'Rheinland-Pfalz',
        'Saarland',
        'Sachsen',
        'Sachsen-Anhalt',
        'Schleswig-Holstein',
        'Thüringen'
    ];

    const cityStates = [
        'Berlin',
        'Hamburg',
        'Bremen',
    ]

    const seenCityStates = new Set<string>();

    const formattedAddress = address
        .filter(
            (x) => !bundeslaender.includes(x.trim()) // no bundeslaender
                && !x.trim().match(/\d{5}$/) // no zip codes at end of string
        )
        .filter((x) => {
            const trimmed = x.trim();
            // If it's a city state, check if we've seen it before
            if (cityStates.includes(trimmed)) {
                if (seenCityStates.has(trimmed)) {
                    return false; // Skip duplicate city state
                }
                seenCityStates.add(trimmed);
            }
            return true;
        })
        .map((x) => {
            return x
                .replace(/Deutschland/g, 'DE')
                .replace(/Österreich/g, 'AT')
                .replace(/Schweiz/g, 'CH')
                .replace(/\d{5} /, ''); // some addresses have: "{zipCode} {city}"
        });

    return formattedAddress.join(' · ');
}

const slugify = (str: string) =>
    str
        .toString()
        .toLowerCase()
        // custom german handling
        .replace('ä', 'ae')
        .replace('ö', 'oe')
        .replace('ü', 'ue')
        .replace('ß', 'ss')
        .normalize('NFD') // split an accented letter in the base letter and the acent
        .replace(/[\u0300-\u036f]/g, '') // remove all previously split accents
        .trim()
        .replace(/[^a-z0-9 ]/g, '') // remove all chars not letters, numbers and spaces
        .replace(/\s+/g, '-') // replace spaces


export function generateSlug({ name, startAt }: { name: string, startAt: Date }) {
    const [day, time] = startAt.toISOString().split('T')
    const hoursMinutes = time.slice(0, 5).replace(':', '')
    return `${slugify(name)}-${day}-${hoursMinutes}`
}

export const cachedImageUrl = (url: string | undefined) => {
    if (!url) return url;
    return `https://res.cloudinary.com/dy7jatmjz/image/fetch/f_auto,q_auto,c_limit,h_768,w_768/${url}`
}

export function stripHtml(html: string | undefined) {
    return html?.replace(/<[^>]*>?/g, '');
}

export const trimAllWhitespaces = (text: string | undefined) => {
    return text?.replace(/\s+/g, ' ').trim();
}

export function getPageMetaTags({ name, description, imageUrl }: { name: string, description: string, imageUrl: string }) {
    const descriptionTeaser = trimAllWhitespaces(stripHtml(description?.slice(0, 140) ?? '')) + "…"
    return {
        title: `${name} | BlissBase`,
        description: descriptionTeaser,
        openGraph: {
            title: name,
            description: descriptionTeaser,
            url: page.url.href,
            images: imageUrl ? [
                {
                    url: imageUrl,
                    alt: name,
                    secureUrl: imageUrl,
                }
            ] : []
        }
    } satisfies MetaTagsProps
}