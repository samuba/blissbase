/**
 * One place an event was seen. Canonical events keep many of these after dedupe.
 */
export type EventSourceOrigin = {
	type: EventSourceOriginType;
	/** Scrape site key, messenger group name, or form label. */
	label: string;
	/** Telegram room id or WhatsApp chat JID when applicable. */
	chatId?: string | null;
	/** Original event URL when known. */
	url?: string | null;
};

export type EventSourceOriginType = `scrape` | `telegram` | `whatsapp` | `website-form`;

const WEBSITE_FORM_SOURCE = `website-form`;

/**
 * Stable identity for merging origins across scrapes.
 * @example
 * sourceOriginKey({ type: `telegram`, label: `Berlin`, chatId: `-1001` })
 */
export function sourceOriginKey(origin: EventSourceOrigin) {
	if (origin.type === `telegram` || origin.type === `whatsapp`) {
		return `${origin.type}:${origin.chatId ?? ``}`;
	}
	if (origin.type === `scrape`) {
		return `scrape:${origin.label}`;
	}
	return origin.type;
}

/**
 * Dedupes origins by {@link sourceOriginKey}; later entries win (prefer fresher labels/urls).
 * @example
 * mergeSourceOrigins([{ type: `scrape`, label: `tribehaus` }], [{ type: `telegram`, label: `X`, chatId: `1` }])
 */
export function mergeSourceOrigins(...lists: Array<EventSourceOrigin[] | null | undefined>) {
	const byKey = new Map<string, EventSourceOrigin>();
	for (const list of lists) {
		if (!list?.length) continue;
		for (const origin of list) {
			const normalized = normalizeSourceOrigin(origin);
			if (!normalized) continue;
			byKey.set(sourceOriginKey(normalized), normalized);
		}
	}
	return Array.from(byKey.values());
}

/**
 * Builds scrape/form origins from classic `source` / `sourceUrl` when callers omit them.
 * Messenger provenance must be supplied via `sourceOrigins` (with chatId).
 */
export function sourceOriginsFromEventFields(event: {
	source?: string | null;
	sourceUrl?: string | null;
	sourceOrigins?: EventSourceOrigin[] | null;
}) {
	const origins: EventSourceOrigin[] = [];

	if (event.source === WEBSITE_FORM_SOURCE) {
		origins.push({ type: `website-form`, label: WEBSITE_FORM_SOURCE, url: event.sourceUrl ?? null });
	} else if (event.source === `telegram` || event.source === `whatsapp`) {
		// Messenger groups live only in sourceOrigins (chatId required).
	} else if (event.source?.trim()) {
		origins.push({
			type: `scrape`,
			label: event.source.trim(),
			url: event.sourceUrl ?? null,
		});
	}

	// Explicit origins win over field-derived ones (e.g. named Telegram groups).
	return mergeSourceOrigins(origins, event.sourceOrigins);
}

/**
 * Ensures an insert/upsert row always carries at least the origins implied by its fields.
 */
export function ensureSourceOrigins(event: {
	source?: string | null;
	sourceUrl?: string | null;
	sourceOrigins?: EventSourceOrigin[] | null;
}) {
	return sourceOriginsFromEventFields(event);
}

/**
 * Builds a messenger origin when the scraper knows the group name.
 */
export function messengerSourceOrigin(args: {
	type: `telegram` | `whatsapp`;
	chatId: string;
	label?: string | null;
	url?: string | null;
}): EventSourceOrigin {
	const chatId = args.chatId.trim();
	return {
		type: args.type,
		label: args.label?.trim() || chatId,
		chatId,
		url: args.url ?? null,
	};
}

function normalizeSourceOrigin(origin: EventSourceOrigin): EventSourceOrigin | undefined {
	const type = origin.type;
	if (type !== `scrape` && type !== `telegram` && type !== `whatsapp` && type !== `website-form`) {
		return undefined;
	}

	const label = origin.label?.trim();
	if (!label) return undefined;

	const chatId = origin.chatId?.trim() || null;
	if ((type === `telegram` || type === `whatsapp`) && !chatId) return undefined;

	const url = origin.url?.trim() || null;
	return { type, label, chatId, url };
}
