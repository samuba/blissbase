import { describe, expect, it, vi } from 'vitest';

vi.mock(`$app/paths`, () => ({
	resolve: (path: string) => path,
}));

const { AUTH_NEXT_QUERY, BASE_URL, isAuthFlowPath, isEventOrOfferingListPath, routePathname, routes, safeAuthNextPath } = await import(`$lib/routes`);

describe(`routePathname`, () => {
	it(`turns relative SSR resolve() results into absolute pathnames`, () => {
		expect(routePathname(`./`, BASE_URL)).toBe(`/`);
		expect(routePathname(`./offerings`, BASE_URL)).toBe(`/offerings`);
	});

	it(`keeps absolute pathnames unchanged`, () => {
		expect(routePathname(`/`, BASE_URL)).toBe(`/`);
		expect(routePathname(`/offerings`, BASE_URL)).toBe(`/offerings`);
	});
});

describe(`isEventOrOfferingListPath`, () => {
	it(`matches the events home and offerings list`, () => {
		expect(isEventOrOfferingListPath({ pathname: `/`, origin: BASE_URL })).toBe(true);
		expect(isEventOrOfferingListPath({ pathname: `/offerings`, origin: BASE_URL })).toBe(true);
	});

	it(`does not match other pages`, () => {
		expect(isEventOrOfferingListPath({ pathname: `/profile`, origin: BASE_URL })).toBe(false);
		expect(isEventOrOfferingListPath({ pathname: `/offerings/yoga`, origin: BASE_URL })).toBe(false);
		expect(isEventOrOfferingListPath({ pathname: `/about`, origin: BASE_URL })).toBe(false);
	});
});

describe(`legal routes`, () => {
	it(`builds privacy policy and terms of service paths`, () => {
		expect(routes.privacyPolicy()).toBe(`/legal/privacy-policy`);
		expect(routes.termsOfService()).toBe(`/legal/terms-of-service`);
	});
});

describe(`auth routes`, () => {
	it(`builds login and callback paths`, () => {
		expect(routes.login()).toBe(`/auth/login`);
		expect(routes.authCallback()).toBe(`/auth/callback`);
	});

	it(`appends a same-origin next path`, () => {
		expect(routes.login({ next: `/profile/favorites` })).toBe(`/auth/login?${AUTH_NEXT_QUERY}=%2Fprofile%2Ffavorites`);
		expect(routes.authCallback({ next: `/profile/favorites` })).toBe(`/auth/callback?${AUTH_NEXT_QUERY}=%2Fprofile%2Ffavorites`);
	});

	it(`does not loop next back into auth routes`, () => {
		expect(routes.login({ next: `/auth/login` })).toBe(`/auth/login`);
		expect(routes.authCallback({ next: `/auth/callback` })).toBe(`/auth/callback`);
	});
});

describe(`isAuthFlowPath`, () => {
	it(`matches login and callback pathnames`, () => {
		expect(isAuthFlowPath(routePathname(routes.login()))).toBe(true);
		expect(isAuthFlowPath(routePathname(routes.authCallback()))).toBe(true);
		expect(isAuthFlowPath(routePathname(routes.profile()))).toBe(false);
	});
});

describe(`safeAuthNextPath`, () => {
	it(`falls back when next is missing or an auth route`, () => {
		expect(safeAuthNextPath({ fallback: `/profile` })).toBe(`/profile`);
		expect(safeAuthNextPath({ next: `/auth/login`, fallback: `/profile` })).toBe(`/profile`);
		expect(safeAuthNextPath({ next: `https://evil.example/phish`, fallback: `/profile` })).toBe(`/profile`);
	});

	it(`keeps a same-origin path including search`, () => {
		expect(safeAuthNextPath({ next: `/offerings?distance=50`, fallback: `/` })).toBe(`/offerings?distance=50`);
	});
});
