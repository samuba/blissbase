import { browser } from "$app/environment";

class IsPwa {
    value = false
    displayMode: ReturnType<typeof this.getPWADisplayMode> = 'unknown'

    constructor() {
        this.displayMode = this.getPWADisplayMode();
        this.value = this.displayMode === 'standalone';
    }

    private getPWADisplayMode() {
        if (!browser) return 'unknown';
        if (document.referrer.startsWith('android-app://')) return 'twa';
        if (window.matchMedia('(display-mode: browser)').matches) return 'browser';
        if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
        if (window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
        if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
        if (window.matchMedia('(display-mode: window-controls-overlay)').matches)
            return 'window-controls-overlay';
    
        return 'unknown';
    }
}

export const isPwa = new IsPwa();