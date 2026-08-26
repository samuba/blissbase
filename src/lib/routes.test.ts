import { describe, expect, it, vi } from 'vitest';

vi.mock(`$app/paths`, () => ({
	resolve: (path: string) => path,
}));

const { BASE_URL, isEventOrOfferingListPath, routePathname } = await import(`$lib/routes`);

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
