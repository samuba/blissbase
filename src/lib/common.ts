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
    let shouldAddWeekday = false;

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
            // Only add weekday if it's not today, tomorrow, or yesterday
            shouldAddWeekday = diffDays !== 0 && diffDays !== 1 && diffDays !== -1;
        } else {
            // Show start date – end date (no times)
            str = dateString; // Initialize str with only the date string, removing the start time
            str += ` – ${end.toLocaleDateString('de-DE', { dateStyle: 'medium' })}`;
            shouldAddWeekday = diffDays !== 0 && diffDays !== 1 && diffDays !== -1;
        }
    } else {
        // No end date - only add weekday if it's not today, tomorrow, or yesterday
        shouldAddWeekday = diffDays !== 0 && diffDays !== 1 && diffDays !== -1;
    }

    // Add German weekday abbreviation for events that are not today, tomorrow, or yesterday
    if (shouldAddWeekday) {
        const weekday = start.toLocaleDateString('de-DE', { weekday: 'short' });
        str = `${weekday}. ${str}`;
    }

    // 00:00 just means we dont have a proper start time
    if (str.endsWith(", 00:00")) str = str.replace(", 00:00", "");
    str = str.replace(", 00:00 – 00:00", "")

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


export function generateSlug({ name, startAt, endAt }: { name: string, startAt: Date, endAt: Date | undefined }) {
    const [day, time] = startAt.toISOString().split('T')
    const hoursMinutes = time.slice(0, 5).replace(':', '')

    // Only include hoursMinutes if endAt is undefined or endAt is more than 12 hours into the next day
    let includeTime = false;

    if (!endAt) {
        // If endAt is undefined, include time
        includeTime = true;
    } else {
        // Check if endAt is more than 12 hours into the next day
        const startDay = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate());
        const nextDay = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);
        const twelveHoursIntoNextDay = new Date(nextDay.getTime() + 12 * 60 * 60 * 1000);

        if (endAt > twelveHoursIntoNextDay) {
            includeTime = true;
        }
    }

    return includeTime ? `${day}-${hoursMinutes}-${slugify(name)}` : `${day}-${slugify(name)}`
}

const maxImageSize = 850

export const cachedImageUrl = (url: string | undefined) => {
    if (!url) return url;
    return `https://res.cloudinary.com/dy7jatmjz/image/fetch/f_auto,q_auto,c_limit,h_${maxImageSize},w_${maxImageSize}/${url}`
}

export async function uploadToCloudinary(buffer: Buffer, publicId: string, cloudinaryCreds: { apiKey: string, cloudName: string }) {
    const formData = new FormData();
    formData.append("file", new Blob([buffer]), `${publicId}.jpg`);
    formData.append("api_key", cloudinaryCreds.apiKey!);
    formData.append("upload_preset", "blissbase");
    formData.append("resource_type", "image");
    formData.append("public_id", publicId);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryCreds.cloudName}/image/upload`, {
        method: "POST",
        body: formData
    });
    if (!res.ok) {
        throw new Error(`Failed to upload to Cloudinary: ${res.statusText} ${await res.text()} bufferlength: ${buffer.length}`);
    }
    return await res.json() as { secure_url: string };
}

export function stripHtml(html: string | undefined) {
    return html?.replace(/<[^>]*>?/g, '');
}

export const trimAllWhitespaces = (text: string | undefined) => {
    return text?.replace(/\s+/g, ' ').trim();
}

export function getPageMetaTags({ name, description, imageUrl, url }: { name: string, description?: string | null, imageUrl?: string | null, url: URL }) {
    const descriptionTeaser = trimAllWhitespaces(stripHtml(description?.slice(0, 140) ?? '')) + "…"
    const title = `${name} | BlissBase`
    return {
        title,
        description: descriptionTeaser,
        canonical: url.href,
        openGraph: {
            title,
            description: descriptionTeaser,
            url: url.href,
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

export function parseTelegramContact(contact: string | undefined) {
    if (!contact?.trim()) return undefined;

    if (contact.startsWith('https://t.me/')) {
        //https://t.me/MagdalenaHSC",
        return `tg://resolve?domain=${contact.slice(14)}`
    }
    if (contact.startsWith('https://t.me/')) {
        //t.me/MagdalenaHSC",
        return `tg://resolve?domain=${contact.slice(6)}`
    }
    if (contact.startsWith('@')) {
        return `tg://resolve?domain=${contact.slice(1)}`
    }
    if (contact.startsWith('+')) {
        return `tel:${contact}`
    }
    if (contact.startsWith('http')) {
        return contact
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
        return `mailto:${contact}`
    }
    return contact;
}