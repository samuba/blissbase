import { prerender } from '$app/server';
import { db, eq, s } from '$lib/server/db';
import { and, isNotNull } from 'drizzle-orm';
import { feature, iso1A2Code } from '@rapideditor/country-coder';

/**
 * Returns the number of listed events for static UI copy.
 *
 * @example
 * await estimateEventCount()
 */
export const estimateEventCount = prerender(async () => {
	return await db.$count(s.events, eq(s.events.listed, true));
});

/**
 * Returns total and upcoming listed-event counts for every country with events.
 *
 * @example
 * await getFaqCountryEventCounts()
 */
export const getFaqCountryEventCounts = prerender(async () => {
	const now = new Date();

	const events = await db
		.select({
			latitude: s.events.latitude,
			longitude: s.events.longitude,
			startAt: s.events.startAt
		})
		.from(s.events)
		.where(
			and(eq(s.events.listed, true), isNotNull(s.events.latitude), isNotNull(s.events.longitude))
		);

	const byCountry = new Map<string, { count: number; upcomingCount: number }>();

	for (const event of events) {
		if (event.latitude == null || event.longitude == null) continue;

		const code = iso1A2Code([event.longitude, event.latitude]);
		if (!code) continue;

		const stats = byCountry.get(code) ?? { count: 0, upcomingCount: 0 };
		stats.count += 1;
		if (event.startAt >= now) stats.upcomingCount += 1;
		byCountry.set(code, stats);
	}

	const regions = [...byCountry.entries()]
		.map(([code, stats]) => ({
			key: code.toLowerCase(),
			label: countryLabelDe(code),
			count: stats.count,
			upcomingCount: stats.upcomingCount
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, `de`));

	return { regions };
});

function countryLabelDe(code: string) {
	return countryLabelsDe[code] ?? feature(code)?.properties?.nameEn ?? code;
}

const countryLabelsDe: Record<string, string> = {
	DE: `Deutschland`,
	AT: `Österreich`,
	CH: `Schweiz`,
	ID: `Indonesien`,
	VN: `Vietnam`,
	PT: `Portugal`,
	FR: `Frankreich`,
	ES: `Spanien`,
	IT: `Italien`,
	NL: `Niederlande`,
	BE: `Belgien`,
	GB: `Vereinigtes Königreich`,
	TH: `Thailand`,
	IN: `Indien`,
	GR: `Griechenland`,
	PL: `Polen`,
	CZ: `Tschechien`,
	HU: `Ungarn`,
	US: `USA`,
	AU: `Australien`,
	EG: `Ägypten`,
	MX: `Mexiko`,
	FI: `Finnland`,
	MA: `Marokko`,
	BR: `Brasilien`,
	IE: `Irland`,
	TR: `Türkei`,
	LI: `Liechtenstein`,
	PE: `Peru`,
	HR: `Kroatien`,
	CO: `Kolumbien`,
	JP: `Japan`,
	SE: `Schweden`,
	PK: `Pakistan`,
	EC: `Ecuador`,
	LU: `Luxemburg`,
	GT: `Guatemala`,
	IL: `Israel`,
	PS: `Palästina`,
	ZA: `Südafrika`,
	UA: `Ukraine`,
	NO: `Norwegen`,
	DK: `Dänemark`,
	AR: `Argentinien`,
	BG: `Bulgarien`,
	MY: `Malaysia`,
	RU: `Russland`,
	CN: `China`,
	CA: `Kanada`,
	IS: `Island`,
	NZ: `Neuseeland`,
	PH: `Philippinen`,
	SG: `Singapur`,
	NP: `Nepal`,
	CR: `Costa Rica`,
	EE: `Estland`,
	LV: `Lettland`,
	BA: `Bosnien und Herzegowina`,
	MK: `Nordmazedonien`,
	MD: `Moldau`,
	LA: `Laos`,
	TN: `Tunesien`,
	UG: `Uganda`,
	BW: `Botswana`,
	SC: `Seychellen`,
	NG: `Nigeria`,
	SD: `Sudan`,
	PY: `Paraguay`,
	IQ: `Irak`,
	ET: `Äthiopien`,
	TZ: `Tansania`
};
