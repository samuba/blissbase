import { describe, expect, it } from 'vitest';
import { WEBSITE_SCRAPE_SOURCES, WEBSITE_SCRAPER_CONFIG } from '../src/lib/commonWithScripts.ts';
import { githubActionsJobOutputs, githubActionsScrapeMatrix, resolveWebsiteScrapePlan, websiteScrapeRetriesOnNewIp } from './website-scrape-plan.ts';

const retrySources = WEBSITE_SCRAPE_SOURCES.filter(websiteScrapeRetriesOnNewIp);
const regularSources = WEBSITE_SCRAPE_SOURCES.filter((source) => !websiteScrapeRetriesOnNewIp(source));

describe(`resolveWebsiteScrapePlan`, () => {
	it(`scrapes every configured source by default`, () => {
		expect(resolveWebsiteScrapePlan([]).sources).toEqual(WEBSITE_SCRAPE_SOURCES);
		expect(resolveWebsiteScrapePlan([]).shouldClean).toBe(false);
	});

	it(`targets a single source from a positional argument`, () => {
		expect(resolveWebsiteScrapePlan([`tribehaus`])).toMatchObject({
			sources: [`tribehaus`],
			targetSource: `tribehaus`,
		});
	});

	it(`scrapes all sources when the positional source is unknown`, () => {
		expect(resolveWebsiteScrapePlan([`not-a-source`]).sources).toEqual(WEBSITE_SCRAPE_SOURCES);
	});

	it(`honors --clean and --exclude`, () => {
		const plan = resolveWebsiteScrapePlan([`--clean`, `--exclude`, `tribehaus,heilnetz`]);
		expect(plan.shouldClean).toBe(true);
		expect(plan.sources).not.toContain(`tribehaus`);
		expect(plan.sources).not.toContain(`heilnetz`);
		expect(plan.excludedSources).toEqual([`tribehaus`, `heilnetz`]);
	});
});

describe(`githubActionsScrapeMatrix`, () => {
	it(`has at most one retryOnNewIp source so the workflow retry chain stays simple`, () => {
		expect(retrySources.length).toBeLessThanOrEqual(1);
	});

	it(`builds the matrix from WEBSITE_SCRAPER_CONFIG instead of a hardcoded list`, () => {
		const { matrixSources, retrySource } = githubActionsScrapeMatrix([]);
		expect(matrixSources).toEqual(regularSources);
		expect(retrySource).toBe(retrySources[0] ?? ``);
		expect(matrixSources).not.toContain(retrySource);
	});

	it(`picks up a newly added config source without YAML changes`, () => {
		const configSources = Object.keys(WEBSITE_SCRAPER_CONFIG);
		const { matrixSources, retrySource } = githubActionsScrapeMatrix([]);
		expect([...matrixSources, retrySource].filter(Boolean).sort()).toEqual([...configSources].sort());
	});

	it(`runs only the named source in the matrix when it does not retry on a new IP`, () => {
		expect(githubActionsScrapeMatrix([`heilnetz`])).toEqual({
			matrixSources: [`heilnetz`],
			retrySource: ``,
			shouldClean: false,
		});
	});

	it(`keeps a retryOnNewIp source out of the matrix so it can retry on a new runner`, () => {
		const retrySource = retrySources[0];
		if (!retrySource) return;
		expect(githubActionsScrapeMatrix([retrySource])).toEqual({
			matrixSources: [],
			retrySource,
			shouldClean: false,
		});
	});

	it(`writes GitHub Actions outputs that skip an empty matrix`, () => {
		expect(githubActionsJobOutputs({
			matrixSources: [],
			retrySource: retrySources[0] ?? ``,
			shouldClean: true,
		})).toBe([
			`sources=["_"]`,
			`has_sources=false`,
			`retry_source=${retrySources[0] ?? ``}`,
			`clean=true`,
		].join(`\n`));
	});
});
