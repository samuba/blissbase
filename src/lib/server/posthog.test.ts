import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServerPosthog } from './posthog';

describe(`createServerPosthog`, () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it(`sends nothing in dev`, async () => {
		const fetchMock = vi.fn(async () => new Response(`{}`));
		vi.stubGlobal(`fetch`, fetchMock);

		const posthog = createServerPosthog({ dev: true });
		await posthog.captureImmediate({ event: `events_fetched`, distinctId: `e2e-user` });
		posthog.captureException(new Error(`boom`), `e2e-user`);
		await posthog.shutdown();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it(`sends events in production`, async () => {
		const fetchMock = vi.fn(async () => new Response(`{}`));
		vi.stubGlobal(`fetch`, fetchMock);

		const posthog = createServerPosthog({ dev: false });
		await posthog.captureImmediate({ event: `events_fetched`, distinctId: `real-user` });
		await posthog.shutdown();

		expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`eu.i.posthog.com`), expect.anything());
	});
});
