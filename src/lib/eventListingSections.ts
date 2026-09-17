const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type EventListingSection = `today` | `tomorrow` | `dayAfterTomorrow` | `restOfWeek` | `nextWeek` | `later`;

export type EventListingDividerSection = Exclude<EventListingSection, `today`>;

export type EventListingItem<T> =
	| { kind: `event`; event: T }
	| { kind: `divider`; section: EventListingDividerSection };

const DIVIDER_SECTIONS = new Set<EventListingSection>([`tomorrow`, `dayAfterTomorrow`, `restOfWeek`, `nextWeek`, `later`]);

function startOfLocalDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function diffLocalDays(from: Date, to: Date) {
	return Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / MS_PER_DAY);
}

function startOfNextWeek(today: Date) {
	const start = startOfLocalDay(today);
	const day = start.getDay();
	const daysUntilNextMonday = day === 0 ? 1 : 8 - day;
	start.setDate(start.getDate() + daysUntilNextMonday);
	return start;
}

function startOfWeekAfterNext(today: Date) {
	const start = startOfNextWeek(today);
	start.setDate(start.getDate() + 7);
	return start;
}

export function getEventListingSection(args: { startAt: Date; now: Date }): EventListingSection {
	const today = startOfLocalDay(args.now);
	const eventDay = startOfLocalDay(args.startAt);
	const diffDays = diffLocalDays(today, eventDay);

	if (diffDays <= 0) return `today`;
	if (diffDays === 1) return `tomorrow`;
	if (diffDays === 2) return `dayAfterTomorrow`;
	if (eventDay.getTime() >= startOfWeekAfterNext(today).getTime()) return `later`;
	if (eventDay.getTime() >= startOfNextWeek(today).getTime()) return `nextWeek`;
	return `restOfWeek`;
}

export function buildEventListingItems<T extends { startAt: Date }>(args: {
	events: T[];
	now: Date;
	showDividers: boolean;
}): EventListingItem<T>[] {
	const { events, now, showDividers } = args;
	if (!showDividers) {
		return events.map((event) => ({ kind: `event`, event }));
	}

	const items: EventListingItem<T>[] = [];
	let previousSection: EventListingSection | null = null;

	for (const event of events) {
		const section = getEventListingSection({ startAt: event.startAt, now });
		if (previousSection != null && section !== previousSection && DIVIDER_SECTIONS.has(section)) {
			items.push({ kind: `divider`, section: section as EventListingDividerSection });
		}
		items.push({ kind: `event`, event });
		previousSection = section;
	}

	return items;
}
