import { inferContactMethod } from '$lib/events.remote.common';
import type { MsgAnalysisAnswer } from './ai';
import { db } from '$lib/server/db';

/**
 * Maps AI extraction output to values for the website create-event form (plus ISO dates for client-side local formatting).
 *
 * @example
 * await mapAiAnswerToCreateEventPrefill({ hasEventData: true, contact: [], tags: [], name: `Yoga` });
 */
export async function mapAiAnswerToCreateEventPrefill(
	analysis: MsgAnalysisAnswer
): Promise<CreateEventPrefillFields> {
	const tagIds = await resolveTagIdsFromAiNames(analysis.tags ?? []);

	let addressLines: string[] = [];
	if (analysis.address) {
		addressLines = analysis.address.split(`,`).map((x) => x.trim()).filter(Boolean);
	}
	if (analysis.venue && !analysis.address?.includes(analysis.venue)) {
		addressLines = [analysis.venue, ...addressLines];
	}
	if (analysis.city && !analysis.address?.includes(analysis.city)) {
		addressLines = [...addressLines, analysis.city];
	}

	const rawContact = pickPrimaryContact(analysis);
	const contact = contactForWebsiteForm(rawContact);
	const contactMethod = inferContactMethod({ contact });

	const attendance = analysis.attendanceMode ?? `offline`;
	const isOnline = attendance === `online`;

	let description = (analysis.description ?? analysis.descriptionBrief ?? ``).trim();
	if (!description) description = `<p></p>`;

	let notice: CreateEventPrefillFields[`notice`];
	let existingSource: string | undefined;
	if (analysis.existingSource) {
		notice = `existingSource`;
		existingSource = analysis.existingSource;
	} else if (!analysis.hasEventData) {
		notice = `noEventData`;
	}

	return {
		name: (analysis.name ?? ``).trim(),
		description,
		tagIds,
		price: (analysis.price ?? ``).trim(),
		address: addressLines.join(`\n`),
		startAtIso: analysis.startDate ? parseIsoToValid(analysis.startDate) : null,
		endAtIso: analysis.endDate ? parseIsoToValid(analysis.endDate) : null,
		isOnline,
		contact,
		contactMethod,
		isNotListed: false,
		...(notice ? { notice, ...(existingSource ? { existingSource } : {}) } : {})
	};
}

/**
 * Resolves AI tag labels (English) to tag id strings for the form.
 *
 * @example
 * await resolveTagIdsFromAiNames([`Yoga`, `Meditation`]);
 */
async function resolveTagIdsFromAiNames(names: string[]): Promise<string[]> {
	if (!names?.length) return [];

	const rows = await db.query.tags.findMany({
		columns: { id: true },
		with: { translations: true }
	});

	const enToId = new Map<string, number>();
	for (const row of rows) {
		const en = row.translations.find((t) => t.locale === `en`)?.name;
		if (en) enToId.set(en.trim().toLowerCase(), row.id);
	}

	const ids: string[] = [];
	for (const name of names) {
		const id = enToId.get(name.trim().toLowerCase());
		if (id !== undefined) ids.push(String(id));
	}

	return ids;
}

function pickPrimaryContact(analysis: MsgAnalysisAnswer): string {
	const first = analysis.contact?.find((c) => c?.trim());
	if (first) return first;
	if (analysis.url?.trim()) return analysis.url.trim();
	return ``;
}

function contactForWebsiteForm(raw: string): string {
	if (!raw?.trim()) return ``;
	const t = raw.trim();
	if (t.startsWith(`mailto:`)) return t.slice(`mailto:`.length);
	if (t.startsWith(`tel:`)) return t.slice(`tel:`.length);
	const tgMatch = t.match(/^tg:\/\/resolve\?domain=([^&]+)/);
	if (tgMatch?.[1]) return `@${tgMatch[1]}`;
	return t;
}

function parseIsoToValid(iso: string): string | null {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	return d.toISOString();
}

export type CreateEventPrefillFields = {
	name: string;
	description: string;
	tagIds: string[];
	price: string;
	address: string;
	startAtIso: string | null;
	endAtIso: string | null;
	isOnline: boolean;
	contact: string;
	contactMethod: string;
	isNotListed: boolean;
	notice?: `existingSource` | `noEventData`;
	existingSource?: string;
};