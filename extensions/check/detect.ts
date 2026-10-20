/**
 * Cross-stack command detection for the check extension.
 *
 * A detector is one pure function over a directory: it reads the manifests it
 * understands and returns the same `DetectedCommands` shape. The registry is
 * ordered, and detection stops at the first family that yields a command, so a
 * Node project with a Makefile does not silently become a `make` project.
 *
 * `check.command` bypasses this module entirely. That is the deliberate escape
 * hatch for stacks without a detector, not a failure of the design.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CheckTarget, CommandSpec, DetectedCommands } from "./types.ts";

/** One family of manifests and the commands it declares. */
export interface Detector {
	/** Stable name for tests and documentation. */
	name: string;
	/** Commands this directory declares, or undefined when it is not this family. */
	detect(cwd: string): DetectedCommands | undefined;
}

/** One resolved command list, or the corrective reason there is none. */
export type PlannedCommands = { ok: true; commands: CommandSpec[] } | { ok: false; error: string };

/** A command whose label is its own text. */
function spec(command: string): CommandSpec {
	return { command, label: command };
}

/** Read a UTF-8 file, or undefined when it is missing or unreadable. */
function read(cwd: string, name: string): string | undefined {
	try {
		return readFileSync(join(cwd, name), "utf-8");
	} catch {
		return undefined;
	}
}

/** Whether a directory entry is a file or a directory. */
function has(cwd: string, name: string, kind: "file" | "dir" = "file"): boolean {
	try {
		const path = join(cwd, name);
		return kind === "dir" ? statSync(path).isDirectory() : statSync(path).isFile();
	} catch {
		return false;
	}
}

/** A plain object, for untrusted JSON. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The package manager whose lockfile is present, defaulting to npm. */
export function packageManager(cwd: string): "bun" | "pnpm" | "yarn" | "npm" {
	if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) return "bun";
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
	return "npm";
}

/** The declared scripts in package.json, or undefined outside a Node project. */
function packageScripts(cwd: string): Record<string, string> | undefined {
	const text = read(cwd, "package.json");
	if (text === undefined) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!isRecord(parsed) || !isRecord(parsed.scripts)) return undefined;
	const scripts: Record<string, string> = {};
	for (const [name, value] of Object.entries(parsed.scripts)) {
		if (typeof value === "string") scripts[name] = value;
	}
	return scripts;
}

const packageDetector: Detector = {
	name: "package.json",
	detect(cwd) {
		const scripts = packageScripts(cwd);
		if (!scripts) return undefined;
		const pm = packageManager(cwd);
		const run = (name: string): CommandSpec | undefined =>
			scripts[name] !== undefined ? spec(`${pm} run ${name}`) : undefined;
		const commands: DetectedCommands = {};
		const test = run("test");
		const lint = run("lint");
		const typecheck = run("typecheck");
		const all = run("check");
		if (test) commands.test = test;
		if (lint) commands.lint = lint;
		if (typecheck) commands.typecheck = typecheck;
		if (all) commands.all = all;
		return Object.keys(commands).length > 0 ? commands : undefined;
	},
};

const cargoDetector: Detector = {
	name: "Cargo.toml",
	detect(cwd) {
		if (!has(cwd, "Cargo.toml")) return undefined;
		return {
			test: spec("cargo test"),
			lint: spec("cargo clippy -- -D warnings"),
			typecheck: spec("cargo check"),
		};
	},
};

const goDetector: Detector = {
	name: "go.mod",
	detect(cwd) {
		if (!has(cwd, "go.mod")) return undefined;
		return {
			test: spec("go test ./..."),
			lint: spec("go vet ./..."),
			typecheck: spec("go build ./..."),
		};
	},
};

const pythonDetector: Detector = {
	name: "python",
	detect(cwd) {
		const pyproject = read(cwd, "pyproject.toml") ?? "";
		const pytest = has(cwd, "pytest.ini") || pyproject.includes("[tool.pytest") || has(cwd, "tests", "dir");
		const commands: DetectedCommands = {};
		if (pytest) commands.test = spec("pytest");
		if (pyproject.includes("[tool.ruff")) commands.lint = spec("ruff check .");
		if (pyproject.includes("[tool.mypy")) commands.typecheck = spec("mypy .");
		return Object.keys(commands).length > 0 ? commands : undefined;
	},
};

/** Declared recipe names in a justfile. */
function justTargets(text: string): Set<string> {
	const targets = new Set<string>();
	for (const line of text.split("\n")) {
		const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(line);
		if (match) targets.add(match[1] ?? "");
	}
	return targets;
}

const justDetector: Detector = {
	name: "justfile",
	detect(cwd) {
		const file = ["justfile", "Justfile", ".justfile"].find((name) => has(cwd, name));
		if (!file) return undefined;
		const targets = justTargets(read(cwd, file) ?? "");
		const commands: DetectedCommands = {};
		for (const [target, name] of [
			["test", "test"],
			["lint", "lint"],
			["typecheck", "typecheck"],
			["all", "check"],
		] as const) {
			if (targets.has(name)) commands[target] = spec(`just ${name}`);
		}
		return Object.keys(commands).length > 0 ? commands : undefined;
	},
};

/** Declared target names in a Makefile. */
function makeTargets(text: string): Set<string> {
	const targets = new Set<string>();
	for (const line of text.split("\n")) {
		const match = /^([A-Za-z0-9_.-]+)\s*:/.exec(line);
		if (match?.[1] && !match[1].startsWith(".")) targets.add(match[1]);
	}
	return targets;
}

const makeDetector: Detector = {
	name: "Makefile",
	detect(cwd) {
		const file = ["Makefile", "makefile"].find((name) => has(cwd, name));
		if (!file) return undefined;
		const targets = makeTargets(read(cwd, file) ?? "");
		const commands: DetectedCommands = {};
		for (const [target, name] of [
			["test", "test"],
			["lint", "lint"],
			["typecheck", "typecheck"],
			["all", "check"],
		] as const) {
			if (targets.has(name)) commands[target] = spec(`make ${name}`);
		}
		return Object.keys(commands).length > 0 ? commands : undefined;
	},
};

/** Detectors in priority order; the first family with a command wins. */
export const DETECTORS: readonly Detector[] = [
	packageDetector,
	cargoDetector,
	goDetector,
	pythonDetector,
	justDetector,
	makeDetector,
];

/** The commands the first matching manifest family declares. */
export function detectCommands(cwd: string): DetectedCommands | undefined {
	for (const detector of DETECTORS) {
		const commands = detector.detect(cwd);
		if (commands) return commands;
	}
	return undefined;
}

/** The ordered targets `all` runs when no all-command exists. */
const ALL_ORDER: ReadonlyArray<Exclude<CheckTarget, "all">> = ["test", "lint", "typecheck"];

/**
 * Resolve the commands for one target.
 *
 * `override` is the user's `check.command`; when set it is the only command, for
 * every target. Otherwise detection supplies the target, and `all` prefers a
 * declared all-command before expanding to the detected targets in order.
 */
export function planCommands(cwd: string, target: CheckTarget, override = ""): PlannedCommands {
	const custom = override.trim();
	if (custom) return { ok: true, commands: [spec(custom)] };

	const detected = detectCommands(cwd);
	if (!detected) {
		return {
			ok: false,
			error: "No check command detected. Set `check.command` in bytefly.json to the command this project uses.",
		};
	}

	if (target !== "all") {
		const command = detected[target];
		if (command) return { ok: true, commands: [command] };
		return {
			ok: false,
			error: `No ${target} command detected. Set \`check.command\` in bytefly.json to the command this project uses.`,
		};
	}

	if (detected.all) return { ok: true, commands: [detected.all] };
	const commands = ALL_ORDER.flatMap((name) => (detected[name] ? [detected[name]] : []));
	if (commands.length > 0) return { ok: true, commands };
	return {
		ok: false,
		error: "No check command detected. Set `check.command` in bytefly.json to the command this project uses.",
	};
}
