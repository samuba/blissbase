import { browser } from "$app/environment";
import { getLongLocale } from "$lib/common";
import { locales } from "./data.js";

class LocaleStore {
    locale: 'en' | 'de' = $state('en');
    longLocale = $derived(getLongLocale(this.locale));

    constructor() {
        if (browser) {
            const cookies = document.cookie.split(';').map(c => {
                const [name, value] = c.trim().split('=');
                return { name, value: decodeURIComponent(value) };
            });
            const cookieLocale = cookies.find(x => x.name === 'locale')?.value;
            const browserLang = navigator.language?.split('-')[0];
            // Cookie wins when valid; otherwise de only for German browsers, else en.
            let locale = cookieLocale && (locales as readonly string[]).includes(cookieLocale)
                ? cookieLocale
                : browserLang === 'de' ? 'de' : 'en';
            this.locale = locale as 'en' | 'de';
            document.cookie = `locale=${this.locale}; path=/; max-age=${60 * 60 * 24 * 365}`;
        }
    }

    setLocale(locale: 'en' | 'de') {
        if (!browser) return;
        if (this.locale === locale) return;
        if (!(locales as readonly string[]).includes(locale)) return;

        document.cookie = `locale=${locale}; path=/; max-age=${60 * 60 * 24 * 365}`;
        this.locale = locale;
        // Reload so SSR (`runWithLocale`) and all catalogs pick up the cookie.
        window.location.reload();
    }
}

export const localeStore = new LocaleStore();
