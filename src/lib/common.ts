
export async function geocodeLocation(location: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
    if (!apiKey) {
        console.error('Google Maps API key is not set. Skipping geocoding.');
        return null;
    }
    try {
        const response = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${apiKey}&language=de&region=DE`
        );
        if (!response.ok) {
            console.error(`Geocoding API request failed with status: ${response.status}`);
            return null;
        }
        const data = await response.json();
        if (data.status === 'OK' && data.results && data.results.length > 0) {
            return data.results[0].geometry.location; // { lat, lng }
        } else {
            console.error('Geocoding failed or no results:', data.status, data.error_message);
            return null;
        }
    } catch (error) {
        console.error('Error during geocoding:', error);
        return null;
    }
}

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
