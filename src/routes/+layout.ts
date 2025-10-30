import type { MetaTagsProps } from 'svelte-meta-tags';
import posthog from 'posthog-js';
import { browser, dev } from '$app/environment';
import { createBrowserClient, createServerClient, isBrowser } from '@supabase/ssr';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import type { LayoutLoad } from './$types';
import { PUBLIC_ADMIN_USER_ID } from '$env/static/public';
import { user } from '$lib/user.svelte';

export const load: LayoutLoad = async ({ url, data: { jwtClaims, cookies, userId, isAdminSession }, depends, fetch }) => {
    /**
     * Declare a dependency so the layout can be invalidated, for example, on
     * session refresh.
     */
    depends('supabase:auth');

    const supabase = isBrowser()
        ? createBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
            global: { fetch },
        })
        : createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
            global: { fetch},
            cookies: {
              getAll() {
                return cookies
              },
            },
          })

    if (browser && !dev && !url.host.endsWith('.vercel.app')) {
        posthog.init('phc_B5MC1SXojC0n2fXhIf9WCDk6O2cqhdLk7SQCT7eldqZ', {
            api_host: 'https://igel.blissbase.app',
            defaults: '2025-05-24',
            person_profiles: 'always', // or 'always' to create profiles for anonymous users as well
        });
        if (isAdminSession) posthog.identify(PUBLIC_ADMIN_USER_ID)
        else if (userId) posthog.identify(userId);
    }


    // --- Meta Tags ---
    const baseUrl = new URL(url.pathname, url.origin).href
    const title = 'Blissbase'
    const description = 'Hippie Events in deiner Nähe.'
    const faviconUrl = 'https://www.blissbase.app/favicon.png'
    const posterUrl = 'https://www.blissbase.app/og-poster.png'
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
                    url: posterUrl,
                    width: 337,
                    height: 450,
                    secureUrl: posterUrl,
                    type: 'image/png'
                }
            ]
        },
        additionalMetaTags: [
            { property: 'og:logo', content: faviconUrl }
        ]
    }) satisfies MetaTagsProps;

    user.id = userId;
    user.isAdmin = isAdminSession;

    return {
        baseMetaTags,
        jwtClaims,
        supabase,
        userId,
    };
};