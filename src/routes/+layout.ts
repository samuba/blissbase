import type { MetaTagsProps } from 'svelte-meta-tags';

export const load = ({ url }) => {

    // --- Meta Tags ---
    const baseUrl = new URL(url.pathname, url.origin).href
    const title = 'BlissBase'
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