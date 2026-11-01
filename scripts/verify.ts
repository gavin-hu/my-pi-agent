/**
 * `bun run check` and `bun run test`: the one command that runs a verification.
 *
 * A verification has two halves — the static gate and the tests — and a scope
 * that says which tests. Both entry scripts point here, so `test` and `check`
 * cannot disagree about how a suite is run or what a scope means, and adding a
 * scope is a flag rather than another `:`-named entry.
 *
 * `test-selection.ts` answers *what*; this module answers *how*: the flag set
 * `bun test` gets, the child's environment, the printed plan, and the exit code.
 */

import { join } from "node:path";
import { runCli } from "./cli.ts";
import {
	type Selection,
	reachIndex,
	selectAll,
	selectChanged,
	selectExt,
	selectLib,
	selectRoot,
	selectSlow,
	tree,
} from "./test-selection.ts";

/** What a run covers, one scope at a time. */
export type Scope = "all" | "static" | "changed" | "ext" | "lib" | "root" | "slow";

/** A parsed command line. */
export interface Plan {
	scope: Scope;
	/** Extension or `lib/` area names, for `ext` and `lib`. */
	names: string[];
	/** The git revision `--changed` diffs against. */
	base: string;
	/** One file at a time, which is what macOS CI runs. */
	serial: boolean;
	/** `bun test --watch`. */
	watch: boolean;
	/** The `test` entry: skip the static half. */
	testsOnly: boolean;
	/** Print the plan and run nothing. */
	dryRun: boolean;
}

/** The flags this command accepts, which is what a doc may name. */
export const FLAGS = [
	"--changed",
	"--base",
	"--ext",
	"--lib",
	"--root",
	"--slow",
	"--static",
	"--serial",
	"--watch",
	"--tests",
	"--dry-run",
] as const;

/** The static half, in the order it runs. */
export const STATIC = ["format:check", "typecheck"] as const;

const USAGE = `usage: bun run check [--static | --changed [--base <ref>] | --ext <name...> | --lib <area...> | --root | --slow]
                    [--serial | --watch] [--dry-run]
       bun run test  the same scopes without the static half`;

const SCOPE_FLAGS: Record<string, Scope> = {
	"--static": "static",
	"--changed": "changed",
	"--ext": "ext",
	"--lib": "lib",
	"--root": "root",
	"--slow": "slow",
};

/**
 * Parse the command line. A scope flag is exclusive, `--base` belongs to
 * `--changed`, and a positional argument is a name only where one is expected —
 * each of those refuses rather than guessing what was meant.
 */
export function parseArgs(argv: string[]): Plan {
	const plan: Plan = {
		scope: "all",
		names: [],
		base: "main",
		serial: false,
		watch: false,
		testsOnly: false,
		dryRun: false,
	};
	let scopeFlag: string | undefined;
	let gaveBase = false;
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		const value = (): string => {
			const next = argv[++index];
			if (next === undefined) throw new Error(`${arg} needs a value`);
			return next;
		};
		const scope = SCOPE_FLAGS[arg];
		if (scope !== undefined) {
			if (scopeFlag !== undefined) throw new Error(`${scopeFlag} and ${arg} pick two scopes; give one`);
			scopeFlag = arg;
			plan.scope = scope;
		} else if (arg === "--base") {
			plan.base = value();
			gaveBase = true;
		} else if (arg === "--serial") plan.serial = true;
		else if (arg === "--watch") plan.watch = true;
		else if (arg === "--tests") plan.testsOnly = true;
		else if (arg === "--dry-run") plan.dryRun = true;
		else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
		else plan.names.push(arg);
	}
	if (gaveBase && plan.scope !== "changed") throw new Error("--base names the revision --changed diffs against");
	if (plan.watch && plan.scope === "static") throw new Error("--watch runs the tests, and --static runs none");
	if ((plan.scope === "ext" || plan.scope === "lib") && plan.names.length === 0) {
		throw new Error(`--${plan.scope} needs a name`);
	}
	if (plan.names.length > 0 && plan.scope !== "ext" && plan.scope !== "lib") {
		throw new Error(`unexpected argument ${plan.names[0]}; a name follows --ext or --lib`);
	}
	return plan;
}

/** The `bun test` flags one plan runs with: how a suite is run, spelled once. */
export function testFlags(plan: Plan): string[] {
	if (plan.watch) return ["--watch", "--isolate"];
	if (plan.serial) return ["--timeout", "30000"];
	return ["--parallel=4", "--timeout", "30000"];
}

/** The whole plan, in the order it runs, so a run can be read before it starts. */
export function planLines(plan: Plan, chosen: Selection | undefined): string[] {
	const lines: string[] = [];
	if (!plan.testsOnly) lines.push(`static > ${STATIC.join(", ")}`);
	if (chosen === undefined) return lines;
	for (const reason of chosen.reasons) lines.push(`  ${reason}`);
	lines.push(`tests > ${chosen.tests.length} files · bun test ${testFlags(plan).join(" ")}`);
	return lines;
}

/** The selection the plan names, or `undefined` for a run that has no tests. */
export function selectionFor(root: string, plan: Plan): Selection | undefined {
	if (plan.scope === "static") return undefined;
	if (plan.scope === "ext") return selectExt(plan.names);
	if (plan.scope === "lib") return selectLib(plan.names);
	if (plan.scope === "root") return selectRoot(tree(root));
	if (plan.scope === "slow") return selectSlow(root);
	if (plan.scope === "changed") return selectChanged(tree(root), changedPaths(root, plan.base), reachIndex(root));
	return selectAll(tree(root));
}

/** Run one child with this process's stdio, and answer its exit code. */
async function run(root: string, args: string[], env: Record<string, string> = {}): Promise<number> {
	const child = Bun.spawn(args, {
		cwd: root,
		stdio: ["inherit", "inherit", "inherit"],
		env: { ...process.env, ...env },
	});
	return await child.exited;
}

/** Every path that differs from `base`: on the branch, in the index, or in the working tree. */
export function changedPaths(root: string, base: string): string[] {
	const paths = new Set<string>();
	const calls = [
		["diff", "--name-only", "--relative", `${base}...HEAD`],
		["diff", "--name-only", "--relative"],
		["diff", "--name-only", "--relative", "--cached"],
		["ls-files", "--others", "--exclude-standard"],
	];
	for (const args of calls) {
		const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
		if (result.exitCode !== 0) {
			const message = result.stderr.toString().trim() || `git ${args.join(" ")} failed`;
			throw new Error(`${message}\n--changed diffs against \`${base}\`; name another revision with --base`);
		}
		for (const path of result.stdout.toString().split("\n")) if (path.trim()) paths.add(path.trim());
	}
	return [...paths].sort();
}

async function main(): Promise<void> {
	const root = join(import.meta.dir, "..");
	const plan = parseArgs(process.argv.slice(2));
	const started = performance.now();
	const chosen = selectionFor(root, plan);
	const elapsed = Math.round(performance.now() - started);
	for (const line of planLines(plan, chosen)) console.log(line);
	// The walk is the one cost a narrowed run pays before its first test: say it.
	if (plan.scope === "changed") console.log(`  selection took ${elapsed}ms`);
	if (plan.dryRun) return;
	if (!plan.testsOnly) {
		for (const script of STATIC) {
			const code = await run(root, [process.execPath, "run", script]);
			if (code !== 0) {
				process.exitCode = code;
				return;
			}
		}
	}
	if (chosen === undefined) return;
	process.exitCode = await run(root, [process.execPath, "test", ...testFlags(plan), ...chosen.tests], {
		...(plan.scope === "slow" ? { PI_SLOW_TESTS: "1" } : {}),
	});
}

if (import.meta.main) {
	if (process.argv.includes("-h") || process.argv.includes("--help")) console.log(USAGE);
	else runCli(USAGE, main);
}
