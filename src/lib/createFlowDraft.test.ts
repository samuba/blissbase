import { describe, expect, it } from "vitest";
import {
	clearCreateFlowDraft,
	EVENT_CREATE_DRAFT_KEY,
	hasPendingCreateFlowDraft,
	loadCreateFlowResume,
	OFFERING_CREATE_DRAFT_KEY,
	peekCreateFlowDraft,
	saveCreateFlowDraft,
	type EventCreateDraft,
	type OfferingCreateDraft,
	createFlowFieldText,
	createFlowResumeStep,
	readCreateFlowFormCheckedValues,
	selectedCreateFlowInputValues,
} from "$lib/createFlowDraft";

class MemoryStorage {
	#map = new Map<string, string>();

	getItem(key: string) {
		return this.#map.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.#map.set(key, value);
	}

	removeItem(key: string) {
		this.#map.delete(key);
	}
}

describe(`createFlowDraft`, () => {
	it(`round-trips a pending offering draft and keeps the payload after consuming pending`, () => {
		const storage = new MemoryStorage();
		const draft = offeringDraft({ savedAt: 1_000 });
		saveCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY, draft, storage });

		expect(hasPendingCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY, storage })).toBe(true);
		expect(loadCreateFlowResume<OfferingCreateDraft>({ key: OFFERING_CREATE_DRAFT_KEY, storage, now: 1_000 })).toEqual({
			draft,
			wasPending: true,
		});
		expect(hasPendingCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY, storage })).toBe(false);
		expect(peekCreateFlowDraft<OfferingCreateDraft>({ key: OFFERING_CREATE_DRAFT_KEY, storage, now: 1_000 })).toEqual(draft);
		expect(loadCreateFlowResume({ key: OFFERING_CREATE_DRAFT_KEY, storage, now: 1_000 })).toEqual({
			draft,
			wasPending: false,
		});
	});

	it(`round-trips an event draft`, () => {
		const storage = new MemoryStorage();
		const draft = eventDraft({ savedAt: 1_000 });
		saveCreateFlowDraft({ key: EVENT_CREATE_DRAFT_KEY, draft, storage });

		expect(loadCreateFlowResume<EventCreateDraft>({ key: EVENT_CREATE_DRAFT_KEY, storage, now: 1_000 })).toEqual({
			draft,
			wasPending: true,
		});
	});

	it(`ignores drafts without a pending Google redirect for auto-publish`, () => {
		const storage = new MemoryStorage();
		storage.setItem(OFFERING_CREATE_DRAFT_KEY, JSON.stringify(offeringDraft({ savedAt: 1_000 })));

		expect(loadCreateFlowResume({ key: OFFERING_CREATE_DRAFT_KEY, storage, now: 1_000 })).toEqual({
			draft: offeringDraft({ savedAt: 1_000 }),
			wasPending: false,
		});
	});

	it(`ignores expired drafts and drops the stored draftId`, () => {
		const storage = new MemoryStorage();
		saveCreateFlowDraft({
			key: EVENT_CREATE_DRAFT_KEY,
			draft: eventDraft({ savedAt: 1_000 }),
			storage,
		});
		expect(storage.getItem(`${EVENT_CREATE_DRAFT_KEY}:draftId`)).toBe(`event-draft`);

		expect(loadCreateFlowResume({ key: EVENT_CREATE_DRAFT_KEY, storage, now: 1_000 + 61 * 60 * 1000 })).toEqual({
			draft: null,
			wasPending: true,
		});
		expect(peekCreateFlowDraft({ key: EVENT_CREATE_DRAFT_KEY, storage, now: 1_000 })).toBeNull();
		expect(storage.getItem(`${EVENT_CREATE_DRAFT_KEY}:draftId`)).toBeNull();
	});

	it(`clears expired JSON even without a draftId side key`, () => {
		const storage = new MemoryStorage();
		storage.setItem(EVENT_CREATE_DRAFT_KEY, JSON.stringify(eventDraft({ savedAt: 1_000 })));

		expect(peekCreateFlowDraft({ key: EVENT_CREATE_DRAFT_KEY, storage, now: 1_000 + 61 * 60 * 1000 })).toBeNull();
		expect(storage.getItem(EVENT_CREATE_DRAFT_KEY)).toBeNull();
	});

	it(`prefers a non-empty field value and otherwise reads nothing without a form`, () => {
		expect(
			createFlowFieldText({
				fieldValue: `<p>Hi</p>`,
				formId: `event-form`,
				name: `description`,
			}),
		).toBe(`<p>Hi</p>`);
		expect(
			createFlowFieldText({
				fieldValue: ``,
				formId: `event-form`,
				name: `description`,
			}),
		).toBe(``);
	});

	it(`resumes unsigned-in drafts on the form unless OAuth came back with an error`, () => {
		expect(
			createFlowResumeStep({
				isSignedIn: false,
				profileStepApplies: false,
				formStep: `event`,
				wasPending: true,
				authError: null,
			}),
		).toBe(`event`);
		expect(
			createFlowResumeStep({
				isSignedIn: false,
				profileStepApplies: false,
				formStep: `offering`,
				wasPending: false,
				authError: null,
			}),
		).toBe(`offering`);
		expect(
			createFlowResumeStep({
				isSignedIn: false,
				profileStepApplies: false,
				formStep: `event`,
				wasPending: true,
				authError: `access_denied`,
			}),
		).toBe(`otp`);
	});

	it(`resumes signed-in drafts on the profile step when the profile is incomplete`, () => {
		expect(
			createFlowResumeStep({
				isSignedIn: true,
				profileStepApplies: true,
				formStep: `event`,
				wasPending: true,
				authError: null,
			}),
		).toBe(`profile`);
		expect(
			createFlowResumeStep({
				isSignedIn: true,
				profileStepApplies: false,
				formStep: `offering`,
				wasPending: true,
				authError: null,
			}),
		).toBe(`offering`);
	});

	it(`reads no form checkbox values without a document`, () => {
		expect(readCreateFlowFormCheckedValues({ formId: `offering-form`, testId: `offering-image-claim` })).toEqual([]);
	});

	it(`keeps checked and hidden claim values in DOM order and skips stale unchecked ones`, () => {
		expect(
			selectedCreateFlowInputValues([
				{ value: `claim-b`, type: `checkbox`, checked: true },
				{ value: `claim-a`, type: `checkbox`, checked: false },
				{ value: `claim-c`, type: `hidden`, checked: false },
				{ value: `claim-b`, type: `hidden`, checked: true },
				{ value: ``, type: `checkbox`, checked: true },
			]),
		).toEqual([`claim-b`, `claim-c`]);
	});

	it(`clears draft, pending flag, and stored draftId`, () => {
		const storage = new MemoryStorage();
		saveCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY, draft: offeringDraft({ savedAt: 1_000 }), storage });
		expect(storage.getItem(`${OFFERING_CREATE_DRAFT_KEY}:draftId`)).toBe(`offering-draft`);
		clearCreateFlowDraft({ key: OFFERING_CREATE_DRAFT_KEY, storage });

		expect(loadCreateFlowResume({ key: OFFERING_CREATE_DRAFT_KEY, storage, now: 1_000 })).toEqual({
			draft: null,
			wasPending: false,
		});
		expect(storage.getItem(`${OFFERING_CREATE_DRAFT_KEY}:draftId`)).toBeNull();
	});
});

function offeringDraft(args: { savedAt: number }): OfferingCreateDraft {
	return {
		v: 1,
		kind: `offering`,
		draftId: `offering-draft`,
		savedAt: args.savedAt,
		requestedStep: `otp`,
		format: `online`,
		email: `host@example.com`,
		socialLinks: [{ type: `website`, value: `https://example.com` }],
		fields: {
			title: `Yoga`,
			descriptionHtml: `<p>Hi</p>`,
			format: `online`,
			imageClaims: [`claim-token-a`, `claim-token-b`],
			email: `host@example.com`,
			returnTo: `/offerings`,
			profile: {
				displayName: `Host`,
				bio: ``,
				profileImageUrl: ``,
				bannerImageUrl: ``,
				locationLabel: ``,
				latitude: ``,
				longitude: ``,
			},
		},
	};
}

function eventDraft(args: { savedAt: number }): EventCreateDraft {
	return {
		v: 1,
		kind: `event`,
		draftId: `event-draft`,
		savedAt: args.savedAt,
		requestedStep: `otp`,
		email: `host@example.com`,
		socialLinks: [],
		fields: {
			name: `Dance`,
			description: `<p>Hi</p>`,
			tagSlugs: [],
			price: ``,
			address: ``,
			addressNote: ``,
			latitude: ``,
			longitude: ``,
			startAt: `2026-09-01T12:00`,
			endAt: ``,
			timeZone: `Europe/Berlin`,
			isOnline: true,
			isNotListed: false,
			contact: ``,
			contactMethod: `none`,
			imageClaims: [],
			email: `host@example.com`,
			profile: {
				displayName: ``,
				bio: ``,
				profileImageUrl: ``,
				bannerImageUrl: ``,
				locationLabel: ``,
				latitude: ``,
				longitude: ``,
			},
		},
	};
}
