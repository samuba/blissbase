import type { MetaTagsProps } from 'svelte-meta-tags';
import posthog from 'posthog-js'
import { browser, dev } from '$app/environment';

export const load = ({ url, data }) => {
    if (browser && !dev && !url.host.endsWith(".vercel.app")) {
        posthog.init('phc_B5MC1SXojC0n2fXhIf9WCDk6O2cqhdLk7SQCT7eldqZ', {
            api_host: 'https://igel.blissbase.app',
            defaults: '2025-05-24',
            person_profiles: 'always', // or 'always' to create profiles for anonymous users as well
        })
        if (data.userId) posthog.identify(data.userId);
    }


    // --- Meta Tags ---
    const baseUrl = new URL(url.pathname, url.origin).href
    const title = 'Blissbase'
    const description = 'Hippie Events in deiner Nähe.'
    const faviconUrl = 'https://www.blissbase.app/favicon.png'
    const baseMetaTags = Object.freeze({
        title,
        description,
        canonical: baseUrl,
        openGraph: {
            type: 'website',
            url: baseUrl,
            locale: 'de_DE',
            title,
            description,
            siteName: title,
            images: [
                {
                    url: faviconUrl,
                    alt: `${title} Logo`,
                    width: 192,
                    height: 192,
                    secureUrl: faviconUrl,
                    type: 'image/png'
                }
            ]
        },
        additionalMetaTags: [
            { property: 'og:logo', content: faviconUrl }
        ]
    }) satisfies MetaTagsProps;

    return {
        baseMetaTags
    };
};