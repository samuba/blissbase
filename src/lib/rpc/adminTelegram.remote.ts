import { command, form, getRequestEvent, query, requested } from '$app/server';
import { error, invalid } from '@sveltejs/kit';
import { asc } from 'drizzle-orm';
import * as v from 'valibot';
import { isAdminSession } from '$lib/server/admin';
import { db, eq, s } from '$lib/server/db';
import { routes } from '$lib/routes';

function toAddressLines(address: string) {
	if (!address.trim()) return [];
	return address.split(/,|\n/).map((x) => x.trim()).filter((x) => x);
}

function parseTopicIds(value: string) {
	const trimmed = value.trim();
	if (!trimmed) return [];

	const parts = trimmed.split(`,`).map((part) => part.trim()).filter((part) => part);
	if (!parts.every((part) => /^-?\d+$/.test(part))) return null;
	return parts.map((part) => BigInt(part));
}

const saveTelegramScrapingTargetSchema = v.object({
	originalRoomId: v.optional(v.string(), ``),
	roomId: v.pipe(v.string(), v.trim(), v.nonEmpty(`roomId ist erforderlich`)),
	defaultAddress: v.pipe(
		v.string(),
		v.transform((value): string[] => toAddressLines(value)),
	),
	topicIds: v.pipe(
		v.string(),
		v.check((value) => parseTopicIds(value) !== null, `topicIds muss eine kommagetrennte Zahlenliste sein, z.B. 1, 2`),
		v.transform((value): bigint[] => parseTopicIds(value) ?? []),
	),
	defaultTimezone: v.optional(
		v.pipe(v.string(), v.trim(), v.nonEmpty(`defaultTimezone ist erforderlich`)),
		`germany`,
	),
	hasOnlyConsciousEvents: v.optional(v.boolean(), false),
});

export const getTelegramScrapingTargets = query(async () => {
	assertAdmin();

	const rows = await db.query.telegramScrapingTargets.findMany({
		orderBy: [asc(s.telegramScrapingTargets.name), asc(s.telegramScrapingTargets.roomId)],
	});

	return rows.map((target) => ({
		...target,
		lastMessageId: target.lastMessageId?.toString() ?? null,
		topicIds: target.topicIds.map((id) => id.toString()),
	}));
});

export const saveTelegramScrapingTarget = form(saveTelegramScrapingTargetSchema, async (data, issue) => {
	assertAdmin();

	const originalRoomId = data.originalRoomId?.trim() || null;

	if (originalRoomId) {
		const existing = await db.query.telegramScrapingTargets.findFirst({
			where: eq(s.telegramScrapingTargets.roomId, originalRoomId),
			columns: { roomId: true, name: true },
		});
		if (!existing) {
			return invalid(issue.roomId(`Target wurde nicht gefunden`));
		}

		// Always re-resolve so bare channel ids (1999…) become marked peer ids (-100…).
		let resolved: { roomId: string; name: string };
		try {
			resolved = await resolveTelegramRoom({ roomId: data.roomId });
		} catch (err) {
			const message = err instanceof Error ? err.message : `Telegram-Raum konnte nicht verifiziert werden`;
			return invalid(issue.roomId(message));
		}

		if (resolved.roomId !== originalRoomId) {
			const conflict = await db.query.telegramScrapingTargets.findFirst({
				where: eq(s.telegramScrapingTargets.roomId, resolved.roomId),
				columns: { roomId: true },
			});
			if (conflict) {
				return invalid(issue.roomId(`Ein Target mit roomId ${resolved.roomId} existiert bereits`));
			}
		}

		await db.update(s.telegramScrapingTargets)
			.set({
				roomId: resolved.roomId,
				name: resolved.name,
				defaultAddress: data.defaultAddress,
				topicIds: data.topicIds,
				defaultTimezone: data.defaultTimezone,
				hasOnlyConsciousEvents: data.hasOnlyConsciousEvents,
			})
			.where(eq(s.telegramScrapingTargets.roomId, originalRoomId));

		refreshTelegramScrapingTargets();

		return {
			action: `updated` as const,
			roomId: resolved.roomId,
			name: resolved.name,
		};
	}

	const existing = await db.query.telegramScrapingTargets.findFirst({
		where: eq(s.telegramScrapingTargets.roomId, data.roomId),
		columns: { roomId: true },
	});
	if (existing) {
		return invalid(issue.roomId(`Ein Target mit dieser roomId existiert bereits`));
	}

	let resolved: { roomId: string; name: string };
	try {
		resolved = await resolveTelegramRoom({ roomId: data.roomId });
	} catch (err) {
		const message = err instanceof Error ? err.message : `Telegram-Raum konnte nicht verifiziert werden`;
		return invalid(issue.roomId(message));
	}

	if (resolved.roomId !== data.roomId) {
		const existingResolved = await db.query.telegramScrapingTargets.findFirst({
			where: eq(s.telegramScrapingTargets.roomId, resolved.roomId),
			columns: { roomId: true },
		});
		if (existingResolved) {
			return invalid(issue.roomId(`Aufgelöstes roomId ${resolved.roomId} existiert bereits`));
		}
	}

	await db.insert(s.telegramScrapingTargets).values({
		roomId: resolved.roomId,
		name: resolved.name,
		defaultAddress: data.defaultAddress,
		topicIds: data.topicIds,
		defaultTimezone: data.defaultTimezone,
		hasOnlyConsciousEvents: data.hasOnlyConsciousEvents,
	});

	refreshTelegramScrapingTargets();

	return {
		action: `created` as const,
		roomId: resolved.roomId,
		name: resolved.name,
	};
});

const deleteTelegramScrapingTargetSchema = v.object({
	roomId: v.pipe(v.string(), v.trim(), v.nonEmpty(`roomId ist erforderlich`)),
});

export const deleteTelegramScrapingTarget = command(deleteTelegramScrapingTargetSchema, async ({ roomId }) => {
	assertAdmin();

	const [deleted] = await db
		.delete(s.telegramScrapingTargets)
		.where(eq(s.telegramScrapingTargets.roomId, roomId))
		.returning({
			roomId: s.telegramScrapingTargets.roomId,
			name: s.telegramScrapingTargets.name,
		});

	if (!deleted) {
		error(404, `Target wurde nicht gefunden`);
	}

	refreshTelegramScrapingTargets();

	return deleted;
});

function refreshTelegramScrapingTargets() {
	getTelegramScrapingTargets().refresh();
	void requested(getTelegramScrapingTargets, 1).refreshAll();
}

/**
 * Resolves via the split `/admin/telegram/resolve` function so teleproto never
 * lands in the shared remotes/catchall bundle.
 */
async function resolveTelegramRoom({ roomId }: { roomId: string }) {
	const { fetch, url } = getRequestEvent();
	const res = await fetch(new URL(routes.adminTelegramResolve(), url.origin), {
		method: `POST`,
		headers: { 'content-type': `application/json` },
		body: JSON.stringify({ roomId }),
	});

	if (res.ok) {
		return (await res.json()) as { roomId: string; name: string };
	}

	const body = await res.json().catch(() => null) as { message?: string } | null;
	throw new Error(body?.message ?? `Telegram-Raum konnte nicht verifiziert werden`);
}

function assertAdmin() {
	if (isAdminSession()) return;
	error(403, `Admin only`);
}
