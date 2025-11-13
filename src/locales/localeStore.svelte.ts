import { browser } from "$app/environment";
import { getLongLocale } from "$lib/common";

class LocaleStore {
    locale: 'en' | 'de' = $state('en');
    longLocale = $derived(getLongLocale(this.locale));

    constructor() {
        if (browser) {
            const cookies = document.cookie.split(';').map(c => {
                const [name, value] = c.trim().split('=');
                return { name, value: decodeURIComponent(value) };
            });
            this.locale = cookies.find(x => x.name === 'locale')?.value ?? navigator.language?.split('-')[0] ?? 'en'
            document.cookie = `locale=${this.locale}; path=/; max-age=${60 * 60 * 24 * 365}`;
        }
        console.log('localeStore', this.locale);
    }
}

export const localeStore = new LocaleStore();