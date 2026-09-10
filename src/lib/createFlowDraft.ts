import type { OfferingFormat } from "$lib/rpc/offerings.common";
import type { PublicProfileSocialLinks } from "$lib/rpc/profile.common";

export const OFFERING_CREATE_DRAFT_KEY = `blissbase:create-draft:offering`;
export const EVENT_CREATE_DRAFT_KEY = `blissbase:create-draft:event`;

const DRAFT_MAX_AGE_MS = 60 * 60 * 1000;

export function newCreateFlowDraftId() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function readCreateFlowFormText(args: { formId: string; name: string }) {
	if (typeof document === `undefined`) return ``;
	const form = document.getElementById(args.formId);
	if (!(form instanceof HTMLFormElement)) return ``;
	const el = form.elements.namedItem(args.name);
	if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
	return ``;
}

export function createFlowFieldText(args: { fieldValue: string | undefined; formId: string; name: string }) {
	return args.fieldValue || readCreateFlowFormText({ formId: args.formId, name: args.name });
}

export function readCreateFlowFormCheckedValues(args: { formId: string; testId: string }) {
	if (typeof document === `undefined`) return [] as string[];
	const form = document.getElementById(args.formId);
	if (!(form instanceof HTMLFormElement)) return [];
	return selectedCreateFlowInputValues(
		[...form.querySelectorAll(`[data-testid="${args.testId}"]`)].filter(
			(el): el is HTMLInputElement => el instanceof HTMLInputElement,
		),
	);
}

export function selectedCreateFlowInputValues(inputs: Array<{ value: string; type: string; checked: boolean }>) {
	const values: string[] = [];
	const seen = new Set<string>();
	for (const input of inputs) {
		if (!input.value) continue;
		if (input.type !== `hidden` && !input.checked) continue;
		if (seen.has(input.value)) continue;
		seen.add(input.value);
		values.push(input.value);
	}
	return values;
}

export function createFlowResumeStep<T extends `event` | `offering`>(args: {
	isSignedIn: boolean;
	profileStepApplies: boolean;
	formStep: T;
	wasPending: boolean;
	authError: string | null;
}): T | `profile` | `otp` {
	if (args.isSignedIn) return args.profileStepApplies ? `profile` : args.formStep;
	if (args.wasPending && args.authError) return `otp`;
	return args.formStep;
}

export function hasPendingCreateFlowDraft(args: { key: string; storage?: DraftStorage }) {
	const storage = args.storage ?? browserSessionStorage();
	return storage?.getItem(pendingKey(args.key)) === `1`;
}

export function saveCreateFlowDraft(args: { key: string; draft: CreateFlowDraft; storage?: DraftStorage }) {
	const storage = args.storage ?? browserSessionStorage();
	if (!storage) return;
	storage.setItem(args.key, JSON.stringify(args.draft));
	storage.setItem(pendingKey(args.key), `1`);
	if (args.draft.draftId) storage.setItem(draftIdKey(args.key), args.draft.draftId);
	else storage.removeItem(draftIdKey(args.key));
}

export function peekCreateFlowDraft<T extends CreateFlowDraft>(args: {
	key: string;
	storage?: DraftStorage;
	now?: number;
}): T | null {
	const storage = args.storage ?? browserSessionStorage();
	if (!storage) return null;
	const raw = storage.getItem(args.key);
	if (!raw) return null;

	const draft = parseCreateFlowDraft<T>({ raw, now: args.now });
	if (draft) return draft;
	clearCreateFlowDraft({
		key: args.key,
		storage,
	});
	return null;
}

export function loadCreateFlowResume<T extends CreateFlowDraft>(args: {
	key: string;
	storage?: DraftStorage;
	now?: number;
}): { draft: T | null; wasPending: boolean } {
	const storage = args.storage ?? browserSessionStorage();
	if (!storage) return { draft: null, wasPending: false };

	const wasPending = storage.getItem(pendingKey(args.key)) === `1`;
	if (wasPending) storage.removeItem(pendingKey(args.key));
	return { draft: peekCreateFlowDraft<T>(args), wasPending };
}

export function clearCreateFlowDraft(args: { key: string; storage?: DraftStorage }) {
	const storage = args.storage ?? browserSessionStorage();
	if (!storage) return;
	storage.removeItem(args.key);
	storage.removeItem(pendingKey(args.key));
	storage.removeItem(draftIdKey(args.key));
}

function parseCreateFlowDraft<T extends CreateFlowDraft>(args: { raw: string; now?: number }): T | null {
	try {
		const draft = JSON.parse(args.raw) as T;
		if (draft.v !== 1) return null;
		const savedAt = draft.savedAt;
		if (typeof savedAt !== `number` || (args.now ?? Date.now()) - savedAt > DRAFT_MAX_AGE_MS) return null;
		return draft;
	} catch {
		return null;
	}
}

function pendingKey(key: string) {
	return `${key}:pending`;
}

function draftIdKey(key: string) {
	return `${key}:draftId`;
}

function browserSessionStorage() {
	if (typeof sessionStorage === `undefined`) return null;
	return sessionStorage;
}

export type OfferingCreateDraft = {
	v: 1;
	kind: `offering`;
	draftId?: string;
	savedAt: number;
	requestedStep: `offering` | `profile` | `otp`;
	format: OfferingFormat;
	email: string;
	socialLinks: PublicProfileSocialLinks;
	fields: {
		title: string;
		descriptionHtml: string;
		format: OfferingFormat;
		imageClaims: string[];
		email: string;
		returnTo: string;
		profile: CreateFlowDraftProfile;
	};
};

export type EventCreateDraft = {
	v: 1;
	kind: `event`;
	draftId?: string;
	savedAt: number;
	requestedStep: `event` | `profile` | `otp`;
	email: string;
	socialLinks: PublicProfileSocialLinks;
	fields: {
		name: string;
		description: string;
		tagSlugs: string[];
		price: string;
		address: string;
		addressNote: string;
		latitude: string;
		longitude: string;
		startAt: string;
		endAt: string;
		timeZone: string;
		isOnline: boolean;
		isNotListed: boolean;
		contact: string;
		contactMethod: string;
		imageClaims: string[];
		email: string;
		profile: CreateFlowDraftProfile;
	};
};

type CreateFlowDraft = OfferingCreateDraft | EventCreateDraft;

type DraftStorage = {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
};

type CreateFlowDraftProfile = {
	displayName: string;
	bio: string;
	profileImageUrl: string;
	bannerImageUrl: string;
	locationLabel: string;
	latitude: string;
	longitude: string;
};
