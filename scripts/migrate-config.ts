/**
 * One-time migration into the shared `bytefly.json`.
 *
 * Every extension used to read its own `<name>.json`; they now read a top-level
 * section of one document. This script moves each legacy file's content into its
 * section, renames a section that has since been renamed, moves bytefly's own
 * top-level `currency`/`rates`/`peak` under `price`, stamps `version`, and
 * (unless `--keep`) deletes the legacy files. It never reads a legacy file that
 * is malformed and never overwrites an existing section, so a partial migration
 * is safe to re-run.
 *
 * Run:  bun run config:migrate [--project <dir>] [--dry-run] [--keep]
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readJsonResult, SHARED_CONFIG_FILE, writeConfigFile } from "../lib/config.ts";

/** Top-level bytefly keys that now live under `price`. */
const PRICE_KEYS = ["currency", "rates", "peak"] as const;

/** Legacy file name to the top-level section it becomes. */
export const LEGACY_FILES: ReadonlyArray<readonly [file: string, section: string]> = [
	["worktree.json", "worktree"],
	["rewind.json", "rewind"],
	["todo.json", "todo"],
	["goal.json", "goal"],
	["jobs.json", "job"],
	["web-access.json", "web-access"],
	["file-browse.json", "file-browse"],
	["document.json", "file-read"],
	["memory.json", "memory"],
	["wechat.json", "wechat"],
];

/** A section that has since been renamed, as `[old, new]`. */
export const LEGACY_SECTIONS: ReadonlyArray<readonly [from: string, to: string]> = [["document", "file-read"]];

export interface MigrateOptions {
	/** Global scope: the agent directory. */
	agentDir: string;
	/** Project scope: the repository root (its `.pi` directory is used). */
	projectDir: string;
	/** Report what would happen without writing or deleting anything. */
	dryRun?: boolean;
	/** Migrate but keep the legacy files in place. */
	keep?: boolean;
}

/** What happened in one scope. */
export interface ScopeResult {
	/** Absolute path of the `bytefly.json` this scope reads. */
	path: string;
	/** Legacy files moved, as `old -> bytefly.json#section`. */
	moved: string[];
	/** Legacy files left behind because the section already existed. */
	skipped: string[];
	/** Legacy files that exist but are not valid JSON objects. */
	errors: string[];
	/** Whether the document was (or would be) written. */
	wrote: boolean;
}

/** Move bytefly's own price keys under `price` and stamp `version`. */
export function migrateDocument(document: Record<string, unknown>): {
	document: Record<string, unknown>;
	changed: boolean;
} {
	const next = { ...document };
	let changed = false;

	const price: Record<string, unknown> = isRecord(next.price) ? { ...next.price } : {};
	let movedPrice = false;
	for (const key of PRICE_KEYS) {
		if (key in next) {
			price[key] = next[key];
			delete next[key];
			movedPrice = true;
			changed = true;
		}
	}
	if (movedPrice) next.price = price;

	if (next.version === undefined) {
		next.version = 1;
		changed = true;
	}

	return { document: next, changed };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Migrate one scope (its `bytefly.json` and the legacy files beside it). */
export function migrateScope(scopeDir: string, options: { dryRun?: boolean; keep?: boolean } = {}): ScopeResult {
	const path = join(scopeDir, SHARED_CONFIG_FILE);
	const result: ScopeResult = { path, moved: [], skipped: [], errors: [], wrote: false };

	const existing = readJsonResult(path);
	if (existing.state === "error") {
		result.errors.push(`${path} (${existing.error})`);
		return result;
	}

	let document = existing.state === "ok" ? existing.value : {};
	const migrated = migrateDocument(document);
	document = migrated.document;
	result.wrote = migrated.changed;

	for (const [from, to] of LEGACY_SECTIONS) {
		if (!(from in document)) continue;
		if (document[to] !== undefined) {
			result.skipped.push(`${SHARED_CONFIG_FILE}#${from} (already present at #${to})`);
			continue;
		}
		document[to] = document[from];
		delete document[from];
		result.moved.push(`${SHARED_CONFIG_FILE}#${from} -> #${to}`);
		result.wrote = true;
	}

	for (const [file, section] of LEGACY_FILES) {
		const legacyPath = join(scopeDir, file);
		const legacy = readJsonResult(legacyPath);
		if (legacy.state === "absent") continue;
		if (legacy.state === "error") {
			result.errors.push(`${legacyPath} (${legacy.error})`);
			continue;
		}
		if (document[section] !== undefined) {
			result.skipped.push(`${file} (already present at ${SHARED_CONFIG_FILE}#${section})`);
			continue;
		}
		document[section] = legacy.value;
		result.moved.push(`${file} -> ${SHARED_CONFIG_FILE}#${section}`);
		result.wrote = true;
		if (!options.dryRun && !options.keep) rmSync(legacyPath, { force: true });
	}

	if (result.wrote && !options.dryRun) writeConfigFile(path, document);
	return result;
}

/** Migrate both scopes. */
export function migrate(options: MigrateOptions): ScopeResult[] {
	const scopes = { dryRun: options.dryRun, keep: options.keep };
	return [migrateScope(options.agentDir, scopes), migrateScope(join(options.projectDir, ".pi"), scopes)];
}

/** Parse CLI arguments and migrate. */
function main(): void {
	const args = process.argv.slice(2);
	let projectDir = process.cwd();
	const dryRun = args.includes("--dry-run");
	const keep = args.includes("--keep");
	const projectIndex = args.indexOf("--project");
	if (projectIndex !== -1 && args[projectIndex + 1]) projectDir = args[projectIndex + 1] as string;

	console.log(`bytefly config migration${dryRun ? " (dry run)" : ""}`);
	const results = migrate({ agentDir: getAgentDir(), projectDir, dryRun, keep });
	for (const result of results) {
		console.log(`\n${result.path}`);
		if (result.moved.length === 0 && result.skipped.length === 0 && !result.wrote) {
			console.log("  nothing to migrate");
		}
		for (const moved of result.moved) console.log(`  moved ${moved}`);
		for (const skipped of result.skipped) console.log(`  skipped ${skipped}`);
		for (const error of result.errors) console.log(`  error ${error}`);
		if (result.wrote) console.log(dryRun ? "  would write" : "  wrote");
	}
}

if (import.meta.main) main();
