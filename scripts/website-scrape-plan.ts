/**
 * Resolves which website scrape sources to run from CLI args.
 * Also prints GitHub Actions job outputs for a dynamic matrix (no sources hardcoded in YAML).
 *
 * Usage:
 *   bun run scripts/website-scrape-plan.ts [source] [--clean] [--exclude source,...]
 */
import { parseArgs } from 'util';
import { appendFileSync } from 'fs';
import { WEBSITE_SCRAPE_SOURCES, WEBSITE_SCRAPER_CONFIG, type WebsiteScrapeSourceName } from '../src/lib/commonWithScripts.ts';

const DEFAULT_LOG_DIR = `scrape-logs`;

export function websiteScrapeRetriesOnNewIp(source: WebsiteScrapeSourceName) {
	const config = WEBSITE_SCRAPER_CONFIG[source];
	return `retryOnNewIp` in config && config.retryOnNewIp === true;
}

export function resolveWebsiteScrapePlan(args: string[]): WebsiteScrapePlan {
	const { values, positionals } = parseArgs({
		args,
		options: {
			clean: {
				type: `boolean`,
				default: false,
			},
			exclude: {
				type: `string`,
				multiple: true,
			},
			'log-dir': {
				type: `string`,
				default: DEFAULT_LOG_DIR,
			},
		},
		allowPositionals: true,
	});

	const excludedSources = (values.exclude ?? [])
		.flatMap((value) => value.split(`,`))
		.map((value) => value.trim().toLowerCase())
		.filter((excluded) => {
			if (!excluded) return false;
			if (WEBSITE_SCRAPE_SOURCES.includes(excluded as WebsiteScrapeSourceName)) return true;
			console.warn(`Ignoring unknown --exclude source: ${excluded}`);
			return false;
		}) as WebsiteScrapeSourceName[];

	let targetSource: WebsiteScrapeSourceName | null = null;
	if (positionals.length > 0) {
		const sourceArgLower = positionals[0].toLowerCase() as WebsiteScrapeSourceName;
		if (WEBSITE_SCRAPE_SOURCES.includes(sourceArgLower)) {
			targetSource = sourceArgLower;
		} else {
			console.warn(`Invalid source argument: ${positionals[0]}. Valid sources are: ${WEBSITE_SCRAPE_SOURCES.join(`, `)}. Scraping all sources.`);
		}
	}

	const sources = (targetSource ? [targetSource] : WEBSITE_SCRAPE_SOURCES)
		.filter((source) => !excludedSources.includes(source));

	return {
		sources,
		shouldClean: Boolean(values.clean),
		logDir: values[`log-dir`] || DEFAULT_LOG_DIR,
		targetSource,
		excludedSources,
	};
}

/**
 * Splits sources into a GitHub Actions matrix (one job per site) and an optional
 * source that retries on a new runner IP. YAML never lists the targets.
 */
export function githubActionsScrapeMatrix(args: string[]): GithubActionsScrapeMatrix {
	const { sources, shouldClean } = resolveWebsiteScrapePlan(args);
	const retrySources = sources.filter(websiteScrapeRetriesOnNewIp);
	if (retrySources.length > 1) {
		console.warn(`Multiple retryOnNewIp sources; only ${retrySources[0]} will retry on a new IP. Others run once in the matrix.`);
	}

	const retrySource = retrySources[0] ?? ``;
	const matrixSources = sources.filter((source) => source !== retrySource);
	return { matrixSources, retrySource, shouldClean };
}

export function githubActionsJobOutputs(matrix: GithubActionsScrapeMatrix) {
	const sourcesJson = JSON.stringify(matrix.matrixSources.length ? matrix.matrixSources : [`_`]);
	return [
		`sources=${sourcesJson}`,
		`has_sources=${matrix.matrixSources.length > 0}`,
		`retry_source=${matrix.retrySource}`,
		`clean=${matrix.shouldClean}`,
	].join(`\n`);
}

if (import.meta.main) {
	const output = `${githubActionsJobOutputs(githubActionsScrapeMatrix(process.argv.slice(2)))}\n`;
	const githubOutputPath = process.env.GITHUB_OUTPUT;
	if (githubOutputPath) {
		appendFileSync(githubOutputPath, output);
	} else {
		process.stdout.write(output);
	}
}

type WebsiteScrapePlan = {
	sources: WebsiteScrapeSourceName[];
	shouldClean: boolean;
	logDir: string;
	targetSource: WebsiteScrapeSourceName | null;
	excludedSources: WebsiteScrapeSourceName[];
};

type GithubActionsScrapeMatrix = {
	matrixSources: WebsiteScrapeSourceName[];
	retrySource: WebsiteScrapeSourceName | ``;
	shouldClean: boolean;
};
