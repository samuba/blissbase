/**
 * HTTP client for scrapers that sit behind bot protection (Cloudflare, SiteGround).
 *
 * A scraper gets flagged when it behaves unlike a browser tab, so a session:
 * - keeps one identity for the whole run (browsers never swap User-Agent mid-session)
 * - carries cookies, including across redirects, so `__cf_bm` and friends survive
 * - sends fetch-metadata headers consistent with what the request claims to be
 * - paces every request through a single queue, so concurrency never causes a burst
 * - stops on a challenge instead of retrying, since hammering a soft block escalates it
 *
 * Header hygiene does not hide the TLS/HTTP2 fingerprint. If a site runs full
 * Cloudflare Bot Management a `BlockedError` is the signal that a real browser
 * (or a TLS-impersonating client) is required.
 */
import { NotFoundError, randomInt, sleep } from './common.ts';

export class BlockedError extends Error {
	constructor(url: string, reason: string) {
		super(`Blocked by bot protection (${reason}): ${url}`);
		this.name = `BlockedError`;
	}
}

const BROWSER_PROFILES = [
	{
		userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36`,
		secChUa: `"Chromium";v="145", "Google Chrome";v="145", "Not?A_Brand";v="24"`,
		platform: `"macOS"`,
	},
	{
		userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36`,
		secChUa: `"Chromium";v="145", "Google Chrome";v="145", "Not?A_Brand";v="24"`,
		platform: `"Windows"`,
	},
	{
		userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36`,
		secChUa: `"Chromium";v="144", "Google Chrome";v="144", "Not?A_Brand";v="24"`,
		platform: `"macOS"`,
	},
] as const;

/** Picked once per process: client hints must stay consistent with the User-Agent. */
const PROFILE = BROWSER_PROFILES[randomInt({ min: 0, max: BROWSER_PROFILES.length - 1 })];

const DEFAULT_ACCEPT: Record<RequestKind, string> = {
	document: `text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8`,
	xhr: `*/*`,
	image: `image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8`,
};
const FETCH_MODE: Record<RequestKind, string> = {
	document: `navigate`,
	xhr: `cors`,
	image: `no-cors`,
};
const SAFE_METHODS = new Set([`GET`, `HEAD`]);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const CHALLENGE_MARKERS = [
	`just a moment`,
	`cf-browser-verification`,
	`challenge-platform`,
	`enable javascript and cookies to continue`,
	`attention required`,
	`sgcaptcha`,
];
const MAX_REDIRECTS = 5;

export class BrowserSession {
	readonly #cookies = new Map<string, Map<string, string>>();
	readonly #acceptLanguage: string;
	readonly #minGapMs: number;
	readonly #maxGapMs: number;
	readonly #breatherEvery: number;
	readonly #timeoutMs: number;
	readonly #maxRetries: number;
	#nextSlotAt = 0;
	#requestCount = 0;

	constructor(options: BrowserSessionOptions = {}) {
		this.#acceptLanguage = options.acceptLanguage ?? `en-US,en;q=0.9`;
		this.#minGapMs = options.minGapMs ?? 900;
		this.#maxGapMs = options.maxGapMs ?? 2400;
		this.#breatherEvery = options.breatherEvery ?? 25;
		this.#timeoutMs = options.timeoutMs ?? 15_000;
		this.#maxRetries = options.maxRetries ?? 2;
	}

	get requestCount(): number {
		return this.#requestCount;
	}

	/** Loads a page as a navigation so later XHRs inherit its cookies and referer. */
	async visit(args: { url: string; referer?: string }): Promise<string> {
		const res = await this.fetch({ ...args, kind: `document` });
		return await res.text();
	}

	async json<T>(args: RequestArgs): Promise<T | undefined> {
		const res = await this.fetch({ accept: `application/json`, ...args });
		const text = await res.text();
		if (!text.trim()) return undefined;
		try {
			return JSON.parse(text) as T;
		} catch {
			console.error(`Expected JSON from ${args.url}, got ${res.headers.get(`content-type`) ?? `unknown type`}`);
			return undefined;
		}
	}

	async text(args: RequestArgs): Promise<string> {
		const res = await this.fetch(args);
		return await res.text();
	}

	async fetch(args: RequestArgs): Promise<Response> {
		for (let attempt = 0; ; attempt++) {
			await this.#awaitSlot(args.kind ?? `xhr`);

			let res: Response | undefined;
			let networkError: unknown;
			try {
				res = await this.#send(args);
			} catch (error) {
				if (error instanceof BlockedError) throw error;
				networkError = error;
			}

			if (res?.ok) return res;

			const retryable = networkError !== undefined || RETRYABLE_STATUS.has(res?.status ?? 0);
			const waitMs = retryAfterMs(res) ?? backoffMs(attempt);
			await res?.body?.cancel();

			if (res?.status === 404) throw new NotFoundError(`404 Not Found: ${args.url}`);
			if (!retryable || attempt >= this.#maxRetries) {
				if (networkError) throw networkError;
				throw new Error(`Request failed ${res?.status} ${res?.statusText}: ${args.url}`);
			}

			console.error(`Retrying ${args.url} in ${waitMs}ms (${networkError ?? `${res?.status} ${res?.statusText}`})`);
			await sleep(waitMs);
		}
	}

	/** Follows redirects by hand so cookies set on intermediate hops are kept. */
	async #send(args: RequestArgs): Promise<Response> {
		const kind = args.kind ?? `xhr`;
		let url = args.url;
		let method = args.method ?? `GET`;
		let body = args.body;

		for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
			const res = await fetch(url, {
				method,
				body,
				redirect: `manual`,
				signal: this.#signal(args.signal),
				headers: this.#headers({ ...args, url, method, kind }),
			});
			this.#storeCookies({ url, res });

			const location = res.headers.get(`location`);
			if (!REDIRECT_STATUS.has(res.status) || !location) {
				await this.#assertNotBlocked({ url, res });
				return res;
			}

			const target = new URL(location, url).toString();
			await this.#assertNotBlocked({ url: target, res });
			await res.body?.cancel();

			if (res.status === 303 || (!SAFE_METHODS.has(method) && res.status !== 307 && res.status !== 308)) {
				method = `GET`;
				body = undefined;
			}
			url = target;
		}

		throw new Error(`Too many redirects for ${args.url}`);
	}

	/**
	 * Reserves the next send slot. Concurrent callers queue behind each other, so
	 * raising concurrency raises throughput without ever producing a burst.
	 */
	async #awaitSlot(kind: RequestKind): Promise<void> {
		this.#requestCount += 1;
		// Subresources follow a page load closely; pausing seconds between them
		// would be the odd-looking pattern here.
		let gapMs = kind === `image`
			? randomInt({ min: 120, max: 450 })
			: randomInt({ min: this.#minGapMs, max: this.#maxGapMs });
		if (this.#requestCount % this.#breatherEvery === 0) {
			gapMs += randomInt({ min: 4_000, max: 12_000 });
		}

		const now = Date.now();
		const slotAt = Math.max(now, this.#nextSlotAt);
		this.#nextSlotAt = slotAt + gapMs;
		if (slotAt > now) await sleep(slotAt - now);
	}

	#headers(args: RequestArgs & { url: string; method: string; kind: RequestKind }): Record<string, string> {
		const { url, method, kind, referer } = args;
		const site = fetchSite({ url, referer });

		const headers: Record<string, string> = {
			[`sec-ch-ua`]: PROFILE.secChUa,
			[`sec-ch-ua-mobile`]: `?0`,
			[`sec-ch-ua-platform`]: PROFILE.platform,
			[`User-Agent`]: PROFILE.userAgent,
			Accept: args.accept ?? DEFAULT_ACCEPT[kind],
			[`Sec-Fetch-Site`]: site,
			[`Sec-Fetch-Mode`]: FETCH_MODE[kind],
			[`Sec-Fetch-Dest`]: kind === `xhr` ? `empty` : kind,
			[`Accept-Language`]: this.#acceptLanguage,
		};

		if (kind === `document`) {
			headers[`Upgrade-Insecure-Requests`] = `1`;
			headers[`Sec-Fetch-User`] = `?1`;
		}
		if (referer) headers.Referer = referer;
		// Browsers attach Origin only to CORS-relevant requests, and it is the page's origin.
		if (kind === `xhr` && (!SAFE_METHODS.has(method) || site !== `same-origin`)) {
			headers.Origin = new URL(referer ?? url).origin;
		}
		if (args.contentType) headers[`Content-Type`] = args.contentType;

		const cookie = this.#cookieHeader(url);
		if (cookie) headers.Cookie = cookie;

		return { ...headers, ...args.headers };
	}

	#cookieHeader(url: string): string | undefined {
		const host = new URL(url).hostname.toLowerCase();
		const pairs: string[] = [];
		for (const [domain, jar] of this.#cookies) {
			if (host !== domain && !host.endsWith(`.${domain}`)) continue;
			for (const [name, value] of jar) pairs.push(`${name}=${value}`);
		}
		return pairs.length ? pairs.join(`; `) : undefined;
	}

	#storeCookies(args: { url: string; res: Response }): void {
		const lines = args.res.headers.getSetCookie?.() ?? [];
		if (!lines.length) return;

		const host = new URL(args.url).hostname.toLowerCase();
		for (const line of lines) {
			const [pair, ...attributes] = line.split(`;`);
			const separator = pair.indexOf(`=`);
			if (separator < 1) continue;

			const domain = cookieAttribute({ attributes, name: `domain` })?.replace(/^\./, ``) ?? host;
			const jar = this.#cookies.get(domain) ?? new Map<string, string>();
			this.#cookies.set(domain, jar);

			const name = pair.slice(0, separator).trim();
			const maxAge = cookieAttribute({ attributes, name: `max-age` });
			if (maxAge !== undefined && Number(maxAge) <= 0) {
				jar.delete(name);
				continue;
			}
			jar.set(name, pair.slice(separator + 1).trim());
		}
	}

	async #assertNotBlocked(args: { url: string; res: Response }): Promise<void> {
		const { url, res } = args;
		if (res.headers.get(`cf-mitigated`) === `challenge`) throw new BlockedError(url, `cloudflare challenge`);
		if (url.includes(`/.well-known/sgcaptcha/`)) throw new BlockedError(url, `siteground captcha`);
		if (res.status !== 403 && res.status !== 429 && res.status !== 503) return;

		const body = (await res.clone().text()).slice(0, 4000).toLowerCase();
		const marker = CHALLENGE_MARKERS.find((candidate) => body.includes(candidate));
		if (marker) throw new BlockedError(url, marker);
	}

	#signal(signal?: AbortSignal): AbortSignal {
		const timeout = AbortSignal.timeout(this.#timeoutMs);
		return signal ? AbortSignal.any([signal, timeout]) : timeout;
	}
}

function fetchSite(args: { url: string; referer?: string }): string {
	if (!args.referer) return `none`;

	const target = new URL(args.url);
	const from = new URL(args.referer);
	if (target.origin === from.origin) return `same-origin`;
	if (isSameSite({ a: target.hostname, b: from.hostname })) return `same-site`;
	return `cross-site`;
}

function isSameSite(args: { a: string; b: string }): boolean {
	const a = args.a.toLowerCase();
	const b = args.b.toLowerCase();
	return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function cookieAttribute(args: { attributes: string[]; name: string }): string | undefined {
	const prefix = `${args.name}=`;
	const match = args.attributes
		.map((attribute) => attribute.trim())
		.find((attribute) => attribute.toLowerCase().startsWith(prefix));
	return match?.slice(prefix.length).trim().toLowerCase();
}

function retryAfterMs(res?: Response): number | undefined {
	const header = res?.headers.get(`retry-after`);
	if (!header) return undefined;

	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.min(seconds * 1000, 60_000);

	const date = Date.parse(header);
	if (Number.isNaN(date)) return undefined;
	return Math.min(Math.max(date - Date.now(), 0), 60_000);
}

function backoffMs(attempt: number): number {
	const base = Math.min(1500 * 2 ** attempt, 20_000);
	return base + randomInt({ min: 0, max: Math.floor(base / 2) });
}

export type RequestKind = `document` | `xhr` | `image`;

type RequestArgs = {
	url: string;
	kind?: RequestKind;
	method?: string;
	referer?: string;
	accept?: string;
	contentType?: string;
	body?: BodyInit;
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

type BrowserSessionOptions = {
	acceptLanguage?: string;
	minGapMs?: number;
	maxGapMs?: number;
	/** Insert a longer, human-like break every N requests. */
	breatherEvery?: number;
	timeoutMs?: number;
	maxRetries?: number;
};
