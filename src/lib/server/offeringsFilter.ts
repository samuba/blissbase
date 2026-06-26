import { resolveFilterCoordinates } from '$lib/server/locationDistance';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY!;

export async function resolveOfferingsFilterCoordinates(args: {
	plzCity?: string | null;
	distance?: string | null;
	lat?: number | null;
	lng?: number | null;
}) {
	if (!args.distance) return null;

	return await resolveFilterCoordinates({
		plzCity: args.plzCity,
		lat: args.lat,
		lng: args.lng,
		apiKey: GOOGLE_MAPS_API_KEY,
	});
}
