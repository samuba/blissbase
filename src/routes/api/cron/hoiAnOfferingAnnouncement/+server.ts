import { error, json, type RequestHandler } from "@sveltejs/kit";
import type { Config } from "@sveltejs/adapter-vercel";
import { env } from "$env/dynamic/private";
import { parseOfferingsFilterFromUrl } from "$lib/offeringsFilter";
import { isBearerTokenAuthorized } from "$lib/server/bearerAuth";
import { generateOfferingAnnouncementForUrl } from "$lib/server/offeringAnnouncement";
import { hoiAnOfferingsPageUrl } from "$lib/server/offeringAnnouncementText";
import { bustOfferingsOgImageCache, warmOfferingsOgForFilter } from "$lib/server/og/offeringsOg";

// Weekly Hoi An offerings announcement for a scheduled curl (no browser login).
// Auth: Authorization: Bearer $ANNOUNCEMENT_API_TOKEN
// curl -fsS https://blissbase.app/api/cron/hoiAnOfferingAnnouncement -H "Authorization: Bearer $ANNOUNCEMENT_API_TOKEN"

export const config: Config = {
	maxDuration: 60,
};

const handle: RequestHandler = async ({ request }) => {
	if (
		!isBearerTokenAuthorized({
			authorization: request.headers.get(`authorization`),
			token: env.ANNOUNCEMENT_API_TOKEN,
		})
	) {
		error(401, `Unauthorized`);
	}

	const url = hoiAnOfferingsPageUrl();
	const generated = await generateOfferingAnnouncementForUrl(url);
	const { deletedCount } = await bustOfferingsOgImageCache();
	const { warmed } = await warmOfferingsOgForFilter(parseOfferingsFilterFromUrl(new URL(url)));

	return json({
		announcement: generated.announcement,
		location: generated.location,
		url: generated.url,
		offeringCount: generated.offeringCount,
		deletedCount,
		warmed,
	});
};

export const GET = handle;
export const POST = handle;
