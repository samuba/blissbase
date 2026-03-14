import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const functionsRoot = path.join(workspaceRoot, '.vercel', 'output', 'functions');
const groupedRoot = path.join(functionsRoot, '![-]');

main();

/**
 * Prints a size-oriented summary of the built Vercel functions.
 *
 * @example
 * node scripts/analyze-vercel-functions.mjs
 */
function main() {
	if (!fs.existsSync(functionsRoot)) {
		console.error(`Missing ${functionsRoot}. Run a build first.`);
		process.exit(1);
	}

	if (!fs.existsSync(groupedRoot)) {
		console.error(`Missing ${groupedRoot}. This script currently expects grouped Vercel functions.`);
		process.exit(1);
	}

	const functionDirs = getChildDirectories(groupedRoot);
	if (!functionDirs.length) {
		console.error(`No grouped functions found in ${groupedRoot}.`);
		process.exit(1);
	}

	printSection(`Function sizes`);
	for (const fn of functionDirs) {
		const totalBytes = getDirectorySize(fn.absPath);
		const topLevelSizes = getTopLevelEntrySizes(fn.absPath);
		console.log(`${fn.name}: ${formatMb(totalBytes)}`);
		for (const entry of topLevelSizes.slice(0, 5)) {
			console.log(`  ${entry.name}: ${formatMb(entry.bytes)}`);
		}
	}

	printSection(`Large duplicated packages`);
	for (const pkg of getDuplicatedPackages(functionDirs)) {
		console.log(`${pkg.name}: ${formatMb(pkg.bytes)} -> ${pkg.functions.join(', ')}`);
	}

	printSection(`Remote manifest entries`);
	for (const fn of functionDirs) {
		const manifestPath = path.join(fn.absPath, '.svelte-kit', 'vercel-tmp', 'manifest.js');
		if (!fs.existsSync(manifestPath)) continue;

		const manifestContent = fs.readFileSync(manifestPath, 'utf8');
		const remoteIds = [...manifestContent.matchAll(/remote-[^.]+\.js/g)].map((x) => x[0]);
		console.log(`${fn.name}: ${remoteIds.length} remotes`);
		for (const remoteId of remoteIds) {
			console.log(`  ${remoteId}`);
		}
	}

	printSection(`Exact heavy package breakdown`);
	const exampleFunction = functionDirs[0];
	for (const pkgName of [`@img`, `@electric-sql`]) {
		const pkgPath = path.join(exampleFunction.absPath, 'node_modules', pkgName);
		if (!fs.existsSync(pkgPath)) continue;

		console.log(`${pkgName} in ${exampleFunction.name}:`);
		for (const child of getChildDirectories(pkgPath)) {
			console.log(`  ${child.name}: ${formatMb(getDirectorySize(child.absPath))}`);
		}
	}

	printSection(`Why they are included`);
	const dbChunkPath = path.join(exampleFunction.absPath, '.svelte-kit', 'output', 'server', 'chunks', 'db.js');
	if (fs.existsSync(dbChunkPath)) {
		const dbChunk = fs.readFileSync(dbChunkPath, 'utf8');
		const hasPgliteGate = dbChunk.includes(`process.env.E2E_TEST === "true"`);
		if (hasPgliteGate) {
			console.log(`db.js still contains a runtime E2E branch, so db.pglite.js stays traceable.`);
		}
	}

	const remoteChunkPath = path.join(exampleFunction.absPath, '.svelte-kit', 'output', 'server', 'chunks', 'eventMutations.remote.js');
	if (fs.existsSync(remoteChunkPath)) {
		const remoteChunk = fs.readFileSync(remoteChunkPath, 'utf8');
		const importsImageProcessing = remoteChunk.includes(`import("./imageProcessing.js")`);
		if (importsImageProcessing) {
			console.log(`eventMutations.remote.js imports imageProcessing.js, which keeps sharp reachable.`);
		}
	}
}

/**
 * Returns child directories for the given absolute path.
 *
 * @example
 * getChildDirectories(`/tmp`)
 */
function getChildDirectories(absPath) {
	return fs.readdirSync(absPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			name: entry.name,
			absPath: path.join(absPath, entry.name)
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Returns the recursive size of a directory in bytes.
 *
 * @example
 * getDirectorySize(`/tmp/example`)
 */
function getDirectorySize(absPath) {
	let bytes = 0;

	for (const entry of fs.readdirSync(absPath, { withFileTypes: true })) {
		const entryPath = path.join(absPath, entry.name);
		if (entry.isDirectory()) {
			bytes += getDirectorySize(entryPath);
			continue;
		}

		bytes += fs.statSync(entryPath).size;
	}

	return bytes;
}

/**
 * Summarizes direct children of a directory by total recursive bytes.
 *
 * @example
 * getTopLevelEntrySizes(`/tmp/example`)
 */
function getTopLevelEntrySizes(absPath) {
	return fs.readdirSync(absPath, { withFileTypes: true }).map((entry) => {
		const entryPath = path.join(absPath, entry.name);
		return {
			name: entry.name,
			bytes: entry.isDirectory() ? getDirectorySize(entryPath) : fs.statSync(entryPath).size
		};
	}).sort((a, b) => b.bytes - a.bytes);
}

/**
 * Finds large packages duplicated across grouped functions.
 *
 * @example
 * getDuplicatedPackages([{ name: `0.func`, absPath: `/tmp/0.func` }])
 */
function getDuplicatedPackages(functionDirs) {
	const packageMap = new Map();

	for (const fn of functionDirs) {
		const nodeModulesPath = path.join(fn.absPath, 'node_modules');
		if (!fs.existsSync(nodeModulesPath)) continue;

		for (const entry of getNodeModulesEntries(nodeModulesPath)) {
			const bytes = getDirectorySize(entry.absPath);
			const key = `${entry.name}:${bytes}`;
			const item = packageMap.get(key) ?? {
				name: entry.name,
				bytes,
				functions: []
			};

			item.functions.push(fn.name);
			packageMap.set(key, item);
		}
	}

	return [...packageMap.values()]
		.filter((item) => item.functions.length > 1 && item.bytes >= 100_000)
		.sort((a, b) => b.bytes - a.bytes);
}

/**
 * Returns package directories from a node_modules folder, including scoped packages.
 *
 * @example
 * getNodeModulesEntries(`/tmp/node_modules`)
 */
function getNodeModulesEntries(nodeModulesPath) {
	const entries = [];

	for (const entry of fs.readdirSync(nodeModulesPath, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;

		const entryPath = path.join(nodeModulesPath, entry.name);
		if (!entry.name.startsWith(`@`)) {
			entries.push({ name: entry.name, absPath: entryPath });
			continue;
		}

		entries.push({ name: entry.name, absPath: entryPath });
	}

	return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Formats bytes as MB with two decimals.
 *
 * @example
 * formatMb(1048576)
 */
function formatMb(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Prints a section heading.
 *
 * @example
 * printSection(`Example`)
 */
function printSection(title) {
	console.log(`\n## ${title}`);
}
