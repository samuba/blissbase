import {
	ensureSourceOrigins,
	type EventSourceOrigin,
} from "./eventSourceOrigins";

/**
 * Website/form origins that own scrape lifecycle. Messenger does not keep a row alive
 * when its last non-messenger scrape origin goes stale.
 */
export function isNonMessengerOrigin(origin: EventSourceOrigin) {
	return origin.type === `scrape` || origin.type === `website-form`;
}

/**
 * Decides whether a stale website scrape should delete the event or only strip that origin.
 * @example
 * planStaleSourceCleanup({ event: { source: `tribehaus`, sourceOrigins: [...] }, staleSources: [`tribehaus`] })
 */
export function planStaleSourceCleanup(args: {
	event: {
		source: string;
		sourceUrl?: string | null;
		sourceOrigins?: EventSourceOrigin[] | null;
	};
	staleSources: string[];
}): StaleSourceCleanupPlan {
	const staleSet = new Set(args.staleSources.filter((source) => source.trim()));
	if (!staleSet.size) return { action: `noop` };

	const origins = ensureSourceOrigins(args.event);
	const hasStaleScrapeOrigin = origins.some(
		(origin) => origin.type === `scrape` && staleSet.has(origin.label),
	);
	const sourceColumnIsStale = staleSet.has(args.event.source);
	if (!hasStaleScrapeOrigin && !sourceColumnIsStale) return { action: `noop` };

	const remainingOrigins = origins.filter(
		(origin) => !(origin.type === `scrape` && staleSet.has(origin.label)),
	);
	const remainingNonMessenger = remainingOrigins.filter(isNonMessengerOrigin);
	if (!remainingNonMessenger.length) return { action: `delete` };

	const nextSource = remainingNonMessenger[0]!.type === `website-form`
		? `website-form`
		: remainingNonMessenger[0]!.label;
	const nextSourceUrl = pickSourceUrlAfterStaleRemoval({
		currentUrl: args.event.sourceUrl,
		removedOrigins: origins.filter((origin) => origin.type === `scrape` && staleSet.has(origin.label)),
		remainingNonMessenger,
	});

	return {
		action: `update`,
		source: nextSource,
		sourceUrl: nextSourceUrl,
		sourceOrigins: remainingOrigins,
	};
}

function pickSourceUrlAfterStaleRemoval(args: {
	currentUrl?: string | null;
	removedOrigins: EventSourceOrigin[];
	remainingNonMessenger: EventSourceOrigin[];
}) {
	const currentUrl = args.currentUrl?.trim() || null;
	const removedUrls = new Set(
		args.removedOrigins.map((origin) => origin.url?.trim()).filter(Boolean) as string[],
	);
	if (currentUrl && !removedUrls.has(currentUrl)) return currentUrl;

	for (const origin of args.remainingNonMessenger) {
		const url = origin.url?.trim();
		if (url) return url;
	}
	return null;
}

type StaleSourceCleanupPlan =
	| { action: `noop` }
	| { action: `delete` }
	| {
			action: `update`;
			source: string;
			sourceUrl: string | null;
			sourceOrigins: EventSourceOrigin[];
	  };
