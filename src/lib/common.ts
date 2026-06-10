import type { MetaTagsProps } from "svelte-meta-tags";

export type Modify<T, R> = Omit<T, keyof R> & R;

export function debounce<T>(func: (...args: T[]) => void, wait: number) {
    let timeout: NodeJS.Timeout;
    return function executedFunction(...args: T[]) {
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

export function addHours(date: Date, hours: number) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function getLongLocale(locale: string) {
    return locale === 'de' ? 'de-DE' : 'en-US';
}

export function formatDatesStr(start: Date | undefined, end: Date | undefined | null, locale: string, excludeCurrentYear = false): string {
    if (!start) return 'Date TBD';

    const { dateString, dateRangeString, multiDayRangeEnd, shouldAddWeekday } = getEventDateFormat({ start, end, locale, excludeCurrentYear });
    let str = dateRangeString ?? dateString;
    if (!dateRangeString && multiDayRangeEnd) str += ` – ${multiDayRangeEnd}`;

    if (!shouldAddWeekday) return str;
    const weekday = formatWeekday(start, locale);
    return `${weekday} ${str}`;
}

export function formatTimesStr(start: Date | undefined, end: Date | undefined | null, locale: string): string {
    if (!start) return 'TBD';

    const longLocale = getLongLocale(locale);
    const { endsOnSameDayOrBeforeNoonNextDay, multiDayRangeEnd } = getEventDateFormat({ start, end, locale });

    if (multiDayRangeEnd) return '';
    if (isMidnight(start) && (!end || isMidnight(end))) return '';

    const startTime = start.toLocaleTimeString(longLocale, { timeStyle: 'short' });

    if (end && endsOnSameDayOrBeforeNoonNextDay) {
        const endTime = end.toLocaleTimeString(longLocale, { timeStyle: 'short' });
        return `${startTime} – ${endTime}`;
    }

    return startTime;
}

/**
 * Calculates date range display details for date and time-only formatters.
 * @example getEventDateFormat({ start: new Date('2025-06-10'), end: new Date('2025-06-12'), locale: 'de', excludeCurrentYear: false })
 */
function getEventDateFormat(args: { start: Date; end: Date | undefined | null; locale: string; excludeCurrentYear?: boolean }) {
    const { start, end, locale, excludeCurrentYear = false } = args;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventStartDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const diffTime = eventStartDay.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    const isRelativeDate = diffDays === 1 || diffDays === 0 || diffDays === -1;
    let dateString: string;
    if (isRelativeDate) {
        const relativeDate = rtf.format(diffDays, 'day');
        // Capitalize first letter for German "Gestern", "Heute", "Morgen"
        dateString = relativeDate.charAt(0).toUpperCase() + relativeDate.slice(1);
    } else {
        dateString = getDateFormatter({ locale, excludeYear: shouldExcludeYear({ date: start, today, excludeCurrentYear }) }).format(start);
    }

    let endsOnSameDayOrBeforeNoonNextDay = false;
    let multiDayRangeEnd: string | undefined;
    let dateRangeString: string | undefined;

    if (end) {
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        const nextDayStart = new Date(startDay.getTime() + 24 * 60 * 60 * 1000);

        // Check if end is on the same day as start OR if end is on the next day and before noon
        endsOnSameDayOrBeforeNoonNextDay =
            startDay.getTime() === endDay.getTime() ||
            (endDay.getTime() === nextDayStart.getTime() && end.getHours() < 12);

        if (!endsOnSameDayOrBeforeNoonNextDay) {
            const dateFormatter = getDateFormatter({
                locale,
                excludeYear: shouldExcludeYear({ date: end, today, excludeCurrentYear })
            });
            multiDayRangeEnd = dateFormatter.format(end);
            if (!isRelativeDate) {
                const dateRangeFormatter = getDateFormatter({
                    locale,
                    excludeYear: shouldExcludeYear({ date: start, today, excludeCurrentYear }) && shouldExcludeYear({ date: end, today, excludeCurrentYear })
                });
                dateRangeString = formatDateRange(dateRangeFormatter, start, end);
            }
        }
    }

    const shouldAddWeekday = diffDays !== 0 && diffDays !== 1 && diffDays !== -1;

    return { dateString, dateRangeString, diffDays, endsOnSameDayOrBeforeNoonNextDay, multiDayRangeEnd, shouldAddWeekday };
}

function isMidnight(date: Date) {
    return date.getHours() === 0 && date.getMinutes() === 0;
}

function formatWeekday(date: Date, locale: string) {
    const weekday = date.toLocaleDateString(getLongLocale(locale), { weekday: 'short' });
    if (!['de', 'en'].includes(locale) || weekday.endsWith('.')) return weekday;
    return `${weekday}.`;
}

function formatDateRange(dateFormatter: Intl.DateTimeFormat, start: Date, end: Date) {
    return dateFormatter.formatRange(start, end).replace(/[\u2009\u202f]\u2013[\u2009\u202f]/u, ' – ');
}

function getDateFormatter(args: { locale: string; excludeYear: boolean }) {
    const { locale, excludeYear } = args;
    const longLocale = getLongLocale(locale);
    if (!excludeYear) return new Intl.DateTimeFormat(longLocale, { day: 'numeric', month: 'short', year: 'numeric' });
    return new Intl.DateTimeFormat(longLocale, { day: 'numeric', month: 'short' });
}

function shouldExcludeYear(args: { date: Date; today: Date; excludeCurrentYear: boolean }) {
    const { date, today, excludeCurrentYear } = args;
    return excludeCurrentYear && date.getFullYear() === today.getFullYear();
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

export const slugify = (str: string) =>
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

export function stripHtml(html: string | undefined) {
    return html?.replace(/<[^>]*>?/g, '');
}

export const trimAllWhitespaces = (text: string | undefined) => {
    return text
        ?.replace(/\s+/g, ' ')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\n/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim();
}

export function getPageMetaTags({ name, description, imageUrl, url, sourceUrl }: { name: string, description?: string | null, imageUrl?: string | null, url: URL, sourceUrl?: string | null }) {
    const descriptionTeaser = trimAllWhitespaces(stripHtml(description?.slice(0, 140) ?? '')) + "…"
    const eventIsFromDifferentWebsite = (sourceUrl?.trim()?.length ?? 0) > 0
    return {
        title: `${name} | Blissbase`,
        description: descriptionTeaser,
        canonical: eventIsFromDifferentWebsite ? sourceUrl! : url.href, // prevent damage to event source SEO ranking due to duplicate content
        robots: eventIsFromDifferentWebsite ? "noindex, follow" : undefined,
        openGraph: {
            title: name,
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

export function parseTelegramContacts(contacts: string[] | undefined) {
    if (!contacts?.length) return [];
    return Array.from(new Set(contacts.map(contact => {
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
    }).filter(x => !!x)! as string[]));
}

// Generates a string of the specified length consisting of only 
// uppercase (A-Z) and lowercase (a-z) English letters.
// Does NOT include numbers, special characters, or non-ASCII letters.
export function randomString(length: number) {
    return Array.from({ length }, () =>
        String.fromCharCode(
            Math.floor(Math.random() * 26) + (Math.random() < 0.5 ? 65 : 97)
        )
    ).join('');
}

// we have it here cuz for some reason having it in app.css via @apply will result in flickering of the dialog content when closing 
// added backface-visibility-hidden and will-change-transform to prevent mobile flickering during animations
export const dialogContentAnimationClasses = 'backface-visibility-hidden will-change-transform data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95';
export const dialogOverlayAnimationClasses = 'backface-visibility-hidden will-change-[opacity] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-150 data-[state=closed]:ease-in data-[state=open]:duration-300 data-[state=open]:ease-out';

export function getContactMethod(contact: string | undefined) {
    if (!contact?.trim()) return undefined;
    if (contact.startsWith('tg://') || contact.startsWith('t.me/') || contact.startsWith('https://t.me/')) {
        return 'Telegram';
    }
    if (contact.startsWith('https://wa.me/') || contact.startsWith('wa.me/') || contact.startsWith('https://api.whatsapp.com') || contact.startsWith('api.whatsapp.com')) {
        return 'WhatsApp';
    }
    if (contact.startsWith('tel:')) {
        return 'Telefon';
    }
    if (contact.startsWith('mailto:')) {
        return 'Email';
    }
    if (contact.match(/^[\w.-]+@[\w.-]+\.\w+$/)) {
        return 'Email';
    }
    if (contact.startsWith('http')) {
        return 'Website';
    }
    return 'Website';
}

export function isTouchDevice() {
    return matchMedia('(hover: none)').matches;
}

export type SupportedLocale = 'en' | 'de';

export function resolveSupportedLocale(locale: string | null | undefined): SupportedLocale {
    if (locale === `de`) return locale;
    return `en`;
}