import { inferContactMethod } from '$lib/events.remote.common';
import { knownTagSlugs } from '$lib/eventCategories';
import type { MsgAnalysisAnswer } from './ai';

/**
 * Maps AI extraction output to values for the website create-event form (plus ISO dates for client-side local formatting).
 *
 * @example
 * mapAiAnswerToCreateEventPrefill({ hasEventData: true, contact: [], tags: [], name: `Yoga` });
 */
export function mapAiAnswerToCreateEventPrefill(
	analysis: MsgAnalysisAnswer
): CreateEventPrefillFields {
	const tagSlugs = knownTagSlugs(analysis.tags);

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

	let description = (analysis.description ?? ``).trim();
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
		tagSlugs,
		price: (analysis.price ?? ``).trim(),
		address: addressLines.join(`, `),
		startAtIso: analysis.startDate ? parseIsoToValid(analysis.startDate) : null,
		endAtIso: analysis.endDate ? parseIsoToValid(analysis.endDate) : null,
		isOnline,
		contact,
		contactMethod,
		isNotListed: false,
		...(notice ? { notice, ...(existingSource ? { existingSource } : {}) } : {})
	};
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
	tagSlugs: string[];
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
