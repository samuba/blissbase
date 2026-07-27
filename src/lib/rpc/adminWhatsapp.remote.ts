import { form, query, requested } from '$app/server';
import { error, invalid } from '@sveltejs/kit';
import { asc, desc, notInArray } from 'drizzle-orm';
import * as v from 'valibot';
import { isAdminSession } from '$lib/server/admin';
import { db, eq, s } from '$lib/server/db';

function toAddressLines(address: string) {
	if (!address.trim()) return [];
	return address.split(/,|\n/).map((x) => x.trim()).filter((x) => x);
}

const saveWhatsappScrapingTargetSchema = v.object({
	originalChatJid: v.optional(v.string(), ``),
	chatJid: v.pipe(v.string(), v.trim(), v.nonEmpty(`chatJid ist erforderlich`)),
	name: v.optional(v.string(), ``),
	defaultAddress: v.pipe(
		v.string(),
		v.transform((value): string[] => toAddressLines(value)),
	),
	defaultTimezone: v.optional(
		v.pipe(v.string(), v.trim(), v.nonEmpty(`defaultTimezone ist erforderlich`)),
		`germany`,
	),
	hasOnlyConsciousEvents: v.optional(v.boolean(), false),
});

export const getWhatsappScrapingTargets = query(async () => {
	assertAdmin();

	return db.query.whatsappScrapingTargets.findMany({
		orderBy: [asc(s.whatsappScrapingTargets.name), asc(s.whatsappScrapingTargets.chatJid)],
	});
});

export const getAvailableWhatsappChats = query(async () => {
	assertAdmin();

	const targets = await db.query.whatsappScrapingTargets.findMany({
		columns: { chatJid: true },
	});
	const targetJids = targets.map((target) => target.chatJid);

	const orderBy = [
		desc(s.whatsappChats.createdAt),
		asc(s.whatsappChats.name),
		asc(s.whatsappChats.chatJid),
	];

	if (!targetJids.length) {
		return db.query.whatsappChats.findMany({ orderBy });
	}

	return db.query.whatsappChats.findMany({
		where: notInArray(s.whatsappChats.chatJid, targetJids),
		orderBy,
	});
});

export const saveWhatsappScrapingTarget = form(saveWhatsappScrapingTargetSchema, async (data, issue) => {
	assertAdmin();

	const originalChatJid = data.originalChatJid?.trim() || null;
	const name = data.name?.trim() || null;

	if (originalChatJid) {
		const existing = await db.query.whatsappScrapingTargets.findFirst({
			where: eq(s.whatsappScrapingTargets.chatJid, originalChatJid),
			columns: { chatJid: true },
		});
		if (!existing) {
			return invalid(issue.chatJid(`Target wurde nicht gefunden`));
		}

		if (data.chatJid !== originalChatJid) {
			const conflict = await db.query.whatsappScrapingTargets.findFirst({
				where: eq(s.whatsappScrapingTargets.chatJid, data.chatJid),
				columns: { chatJid: true },
			});
			if (conflict) {
				return invalid(issue.chatJid(`Ein Target mit dieser chatJid existiert bereits`));
			}
		}

		await db.update(s.whatsappScrapingTargets)
			.set({
				chatJid: data.chatJid,
				name,
				defaultAddress: data.defaultAddress,
				defaultTimezone: data.defaultTimezone,
				hasOnlyConsciousEvents: data.hasOnlyConsciousEvents,
			})
			.where(eq(s.whatsappScrapingTargets.chatJid, originalChatJid));

		refreshWhatsappScrapingTargets();

		return {
			action: `updated` as const,
			chatJid: data.chatJid,
			name: name ?? data.chatJid,
		};
	}

	const existing = await db.query.whatsappScrapingTargets.findFirst({
		where: eq(s.whatsappScrapingTargets.chatJid, data.chatJid),
		columns: { chatJid: true },
	});
	if (existing) {
		return invalid(issue.chatJid(`Ein Target mit dieser chatJid existiert bereits`));
	}

	await db.insert(s.whatsappScrapingTargets).values({
		chatJid: data.chatJid,
		name,
		defaultAddress: data.defaultAddress,
		defaultTimezone: data.defaultTimezone,
		hasOnlyConsciousEvents: data.hasOnlyConsciousEvents,
	});

	refreshWhatsappScrapingTargets();

	return {
		action: `created` as const,
		chatJid: data.chatJid,
		name: name ?? data.chatJid,
	};
});

function refreshWhatsappScrapingTargets() {
	getWhatsappScrapingTargets().refresh();
	void requested(getWhatsappScrapingTargets, 1).refreshAll();
	getAvailableWhatsappChats().refresh();
	void requested(getAvailableWhatsappChats, 1).refreshAll();
}

function assertAdmin() {
	if (isAdminSession()) return;
	error(403, `Admin only`);
}
