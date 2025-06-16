import { browser } from '$app/environment';
import { updated } from '$app/state';

/**
 * Default configuration for auto-refresh functionality
 */
const DEFAULT_CONFIG: Required<AutoRefreshConfig> = {
    storageKey: 'blissbase_last_visible',
    refreshThresholdMs: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
    enableLogging: true
};

/**
 * Sets up automatic page refresh functionality for PWA applications.
 * 
 * This function tracks when the app becomes hidden (minimized, tab switched, browser closed)
 * and automatically refreshes the page when the user returns after a specified time threshold.
 * This ensures users always get the latest version of the PWA without manual intervention.
 * 
 * @param config - Configuration options for auto-refresh behavior
 * @param config.storageKey - Key used to store the last visible timestamp in localStorage (default: 'blissbase_last_visible')
 * @param config.refreshThresholdMs - Time in milliseconds after which to trigger auto-refresh (default: 2 hours)
 * @param config.enableLogging - Whether to log refresh events to console (default: true)
 * 
 * @returns A cleanup function that removes all event listeners when called
 * 
 * @example
 * ```typescript
 * import { setupAutoRefresh } from '$lib/auto-refresh';
 * 
 * // Use with default settings (2 hour threshold)
 * const cleanup = setupAutoRefresh();
 * 
 * // Custom configuration
 * const cleanup = setupAutoRefresh({
 *   refreshThresholdMs: 60 * 60 * 1000, // 1 hour
 *   enableLogging: false,
 *   storageKey: 'my_app_last_seen'
 * });
 * 
 * // Clean up when component unmounts
 * return cleanup;
 * ```
 * 
 * @remarks
 * - Only works in browser environment (returns no-op function on server)
 * - Uses localStorage to persist UTC timestamps across browser sessions
 * - All time comparisons are done using UTC to ensure consistency across timezones
 * - Listens to visibilitychange, beforeunload, and pagehide events
 * - Automatically checks for refresh on initial page load
 * - Only refreshes if there is an update on the server using the updated flag from svelte kit
 */
export function setupAutoRefresh(config: AutoRefreshConfig = {}) {
    if (!browser) return () => { };

    const { storageKey, refreshThresholdMs, enableLogging } = { ...DEFAULT_CONFIG, ...config };

    // Get current UTC timestamp in milliseconds
    const currentTime = () => Date.now();

    // Check if we should refresh on app startup
    const checkForAutoRefresh = () => {
        if (!updated.current) {
            console.log('No update on server, skipping auto-refresh');
            return;
        }

        const lastVisibleTime = localStorage.getItem(storageKey);
        if (lastVisibleTime) {
            const lastVisibleUTC = parseInt(lastVisibleTime);
            const currentUTC = currentTime();
            const timeDiff = currentUTC - lastVisibleUTC;

            if (timeDiff >= refreshThresholdMs) {
                if (enableLogging) {
                    console.log(`Auto-refreshing app after ${Math.round(timeDiff / 1000 / 60)} minutes of inactivity`);
                }
                window.location.reload();
                return;
            }
        }
    };

    // Handle visibility changes
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
            // App is being hidden/minimized - store current UTC timestamp
            localStorage.setItem(storageKey, currentTime().toString());
        } else if (document.visibilityState === 'visible') {
            // App is becoming visible - check if we should refresh
            checkForAutoRefresh();
        }
    };

    // Handle page unload (browser closing, navigation away)
    const handleBeforeUnload = () => {
        localStorage.setItem(storageKey, currentTime().toString());
    };

    // Check for auto-refresh on initial load
    checkForAutoRefresh();

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    // Return cleanup function
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('beforeunload', handleBeforeUnload);
        window.removeEventListener('pagehide', handleBeforeUnload);
    };
}

/**
 * Configuration options for the auto-refresh functionality.
 */
interface AutoRefreshConfig {
    /** 
     * Key used to store the last visible timestamp in localStorage.
     * @default 'blissbase_last_visible'
     */
    storageKey?: string;

    /** 
     * Time in milliseconds after which to trigger auto-refresh.
     * @default 7200000 (2 hours)
     */
    refreshThresholdMs?: number;

    /** 
     * Whether to log refresh events to console for debugging.
     * @default true
     */
    enableLogging?: boolean;
}