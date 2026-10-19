#!/usr/bin/env bun
/**
 * Fail-first / prove-it script for single-day date range close.
 * Drives control-blissbase against a live verify instance (or launches one).
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

const repoRoot = new URL(`../../../..`, import.meta.url).pathname;
const ctrl = [
	bunBin(),
	`${repoRoot}/.cursor/skills/verify-blissbase/scripts/control-blissbase.ts`,
];
const runId = process.env.BLISSBASE_VERIFY_RUN_ID ?? `date-range-single-day`;
const dayName = `Mittwoch, 21. Oktober 2026`;
const dayIso = `2026-10-21`;

function bunBin() {
	if (process.env.BUN_INSTALL) return `${process.env.BUN_INSTALL}/bin/bun`;
	const homeBun = `${homedir()}/.bun/bin/bun`;
	if (existsSync(homeBun)) return homeBun;
	return `bun`;
}

function run(args: string[]) {
	const result = spawnSync(ctrl[0], [...ctrl.slice(1), ...args, `--run-id`, runId], {
		cwd: repoRoot,
		encoding: `utf8`,
		env: process.env,
	});
	const out = `${result.stdout ?? ``}${result.stderr ?? ``}`.trim();
	if (out) console.log(out);
	if (result.status !== 0) {
		throw new Error(`control-blissbase ${args.join(` `)} failed (exit ${result.status})`);
	}
	return out;
}

function tryRun(args: string[]) {
	const result = spawnSync(ctrl[0], [...ctrl.slice(1), ...args, `--run-id`, runId], {
		cwd: repoRoot,
		encoding: `utf8`,
		env: process.env,
	});
	return {
		ok: result.status === 0,
		out: `${result.stdout ?? ``}${result.stderr ?? ``}`.trim(),
	};
}

const launched = tryRun([`doctor`]);
if (!launched.ok) {
	run([`launch`, `--port`, `5191`]);
	run([`doctor`]);
	run([`seed`, `baseline`]);
}

run([`browser`, `start`]);
run([`browser`, `goto`, `--path`, `/`]);
run([`browser`, `wait`, `--testid`, `event-card`]);
run([`browser`, `hydrate`]);
run([`browser`, `click`, `--testid`, `open-filter-dialog`]);
run([`browser`, `expect-visible`, `--testid`, `filter-dialog`]);

const triggerByTestId = tryRun([`browser`, `click`, `--testid`, `date-range-picker-trigger`]);
if (!triggerByTestId.ok) {
	run([`browser`, `click`, `--role`, `button`, `--name`, `Alle zukünftigen Events`]);
}

const dayByTestId = tryRun([`browser`, `click`, `--testid`, `date-range-day-${dayIso}`]);
if (!dayByTestId.ok) {
	run([`browser`, `click`, `--role`, `button`, `--name`, dayName]);
}

run([`browser`, `press`, `--key`, `Escape`]);
run([
	`browser`,
	`screenshot`,
	`--path`,
	`date-range-single-day/after-close.png`,
]);
run([
	`browser`,
	`snapshot`,
	`--path`,
	`date-range-single-day/after-close.aria.txt`,
]);

const snapshotPath = `${repoRoot}/.cursor/skills/verify-blissbase/artifacts/date-range-single-day/after-close.aria.txt`;
const aria = await Bun.file(snapshotPath).text();

const hasEmptyEnd = /spinbutton "day,": tt/.test(aria) || aria.includes(`tt.mm.jjjj`);
const startFilled = /spinbutton "day,": "21"/.test(aria);
const endFilled =
	(aria.match(/spinbutton "day,": "21"/g) ?? []).length >= 2 &&
	(aria.match(/spinbutton "month,": "10"/g) ?? []).length >= 2 &&
	(aria.match(/spinbutton "year,": "2026"/g) ?? []).length >= 2;

if (!startFilled) {
	console.error(`FAIL: start date 21.10.2026 not present after close`);
	process.exit(1);
}
if (hasEmptyEnd || !endFilled) {
	console.error(
		`FAIL: end date still incomplete after single-day close (expected begin=end=2026-10-21)`,
	);
	console.error(`hasEmptyEnd=${hasEmptyEnd} endFilled=${endFilled}`);
	process.exit(1);
}

console.log(
	JSON.stringify({
		ok: true,
		proof: `single-day close completed begin=end=${dayIso}`,
		snapshot: snapshotPath,
	}),
);
