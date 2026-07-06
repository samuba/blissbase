import { browser } from '$app/environment';
import { loadFiltersFromBrowserCookie } from '$lib/cookie-utils';
import { getDistanceInKm, hasValidCoordinates } from '$lib/locationFilter';

const DA_NANG_CENTER = {
	lat: 15.977714,
	lng: 108.280213,
	radiusKm: 100
} as const;

class OfferingsFeatureFlagStore {
	isEnabled = $state(false);

	updateFromPosition = (args: UpdateFromPositionArgs) => {
		if (!hasValidCoordinates({ lat: args.lat, lng: args.lng })) {
			this.isEnabled = false;
			return;
		}

		this.isEnabled =
			getDistanceInKm({
				fromLat: args.lat!,
				fromLng: args.lng!,
				toLat: DA_NANG_CENTER.lat,
				toLng: DA_NANG_CENTER.lng
			}) <= DA_NANG_CENTER.radiusKm;
	};
}

function createOfferingsFeatureFlag() {
	if (!browser) {
		return new OfferingsFeatureFlagStore();
	}

	if (globalThis.__OfferingsFeatureFlag) {
		return globalThis.__OfferingsFeatureFlag;
	}

	const offeringsFeatureFlag = new OfferingsFeatureFlagStore();
	const savedFilters = loadFiltersFromBrowserCookie();

	if (savedFilters) {
		offeringsFeatureFlag.updateFromPosition({ lat: savedFilters.lat, lng: savedFilters.lng });
	}

	globalThis.__OfferingsFeatureFlag = offeringsFeatureFlag;
	return offeringsFeatureFlag;
}

export const OfferingsFeatureFlag = createOfferingsFeatureFlag();

declare global {
	var __OfferingsFeatureFlag: OfferingsFeatureFlagStore | undefined;
}

type UpdateFromPositionArgs = {
	lat?: number | null;
	lng?: number | null;
};
