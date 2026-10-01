import 'dotenv/config'
import { broadestTagSlugs } from '../src/lib/eventCategories'
import { and, asc, db, gt, inArray, s } from '../src/lib/server/db.script.ts'
import { askJev, messageTextForJev } from '../src/lib/server/jev/messengerCheck'

const defaultLimit = 10
const noulYes = 0.5
const topChoices = 4
const topTags = 8
const green = `\x1b[32m`
const red = `\x1b[31m`
const reset = `\x1b[0m`
const messengerSources = [`telegram`, `whatsapp`] as const
const tagNames = new Set<string>(broadestTagSlugs)
const languageFlags: Record<string, string> = {
	english: `🇬🇧`,
	spanish: `🇪🇸`,
	portuguese: `🇵🇹`,
	french: `🇫🇷`,
	german: `🇩🇪`,
	dutch: `🇳🇱`,
	russian: `🇷🇺`,
	ukrainian: `🇺🇦`,
}

async function main() {
	const limit = parseLimit(process.argv.slice(2))
	const events = await db
		.select({
			name: s.events.name,
			slug: s.events.slug,
			description: s.events.description,
			descriptionOriginal: s.events.descriptionOriginal,
		})
		.from(s.events)
		.where(and(
			gt(s.events.startAt, new Date()),
			inArray(s.events.source, [...messengerSources]),
		))
		.orderBy(asc(s.events.startAt))
		.limit(limit)

	if (!events?.length) {
		console.log(`No future telegram or whatsapp events found.`)
		return
	}

	console.log(`Judging ${events.length} future telegram or whatsapp event(s)\n`)

	for (const event of events) {
		const url = `https://blissbase.app/${event.slug}`
		const text = messageTextForJev(event.name + `\n\n` + event.descriptionOriginal || event.description || ``)
		console.log(event.name)
		console.log(url)

		if (!text.length) {
			console.log(`(no text)\n`)
			continue
		}

		try {
			const result = await askJev(text)
			console.log(formatAnswers(result.answers))
		} catch (error) {
			console.error(error)
		}
		console.log(``)
	}
}

function formatAnswers(answers: JevAnswers) {
	const lines: string[] = []
	const tags: { score: number; line: string }[] = []

	for (const [name, answer] of Object.entries(answers)) {
		if (answer.type === `noul`) {
			const line = `${name} ${verdict(answer.noul)} (${formatScore(answer.noul)})`
			if (tagNames.has(name)) {
				tags.push({ score: answer.noul, line })
				continue
			}
			lines.push(line)
			continue
		}
		if (answer.type !== `choice`) continue

		const top = Object.entries(answer.probabilities)
			.sort((a, b) => b[1] - a[1])
			.slice(0, topChoices)
			.map(([label, probability]) => `${choiceLabel({ question: name, label })} (${formatScore(probability)})`)
			.join(`, `)
		lines.push(`${name} ${top} confidence ${formatScore(answer.confidence)}`)
	}

	tags.sort((a, b) => b.score - a.score)
	for (const tag of tags.slice(0, topTags)) lines.push(tag.line)
	return lines.join(`\n`)
}

function verdict(score: number) {
	return score >= noulYes ? `${green}✅${reset}` : `${red}❌${reset}`
}

function choiceLabel({ question, label }: { question: string; label: string }) {
	if (question !== `language`) return label
	const flag = languageFlags[label]
	if (!flag) return label
	return `${flag} ${label}`
}

function formatScore(value: number) {
	return value.toFixed(2)
}

function parseLimit(argv: string[]) {
	const flagIndex = argv.findIndex((arg) => arg === `--limit` || arg === `-n`)
	if (flagIndex >= 0) {
		const raw = argv[flagIndex + 1]
		const parsed = Number(raw)
		if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`Invalid --limit value: ${raw}`)
		return Math.floor(parsed)
	}

	const positional = argv.find((arg) => /^\d+$/.test(arg))
	if (positional) return Number(positional)
	return defaultLimit
}

if (import.meta.main) {
	try {
		await main()
		process.exit(0)
	} catch (error) {
		console.error(`Failed to run askJev on future events:`, error)
		process.exit(1)
	}
}

type JevAnswers = Awaited<ReturnType<typeof askJev>>['answers']
