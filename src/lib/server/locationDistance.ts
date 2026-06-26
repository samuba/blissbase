import { hasValidCoordinates } from '$lib/locationFilter';
import { geocodeAddressCached } from '$lib/server/google';

export async function resolveFilterCoordinates(args: {
	plzCity?: string | null;
	lat?: number | null;
	lng?: number | null;
	apiKey: string;
}) {
	const sanitized = {
		plzCity: args.plzCity ?? null,
		lat: args.lat ?? null,
		lng: args.lng ?? null,
	};

	if (hasValidCoordinates({ lat: sanitized.lat, lng: sanitized.lng })) {
		return { lat: sanitized.lat!, lng: sanitized.lng! };
	}

	if (!sanitized.plzCity?.trim()) return null;

	return await geocodeAddressCached({
		addressLines: [sanitized.plzCity],
		apiKey: args.apiKey,
	});
}
