/**
 * Config-file helpers shared by extensions.
 *
 * Most settings live in one shared document, `bytefly.json`, under the agent
 * directory and `<cwd>/.pi`: each extension owns a top-level section (bytefly
 * itself owns `price`, `notify`, and `doctor`), and project values override
 * global ones. A missing or malformed file is ignored.
 *
 * `readJson` stays deliberately lenient: a malformed file must never break a
 * session. `readJsonResult` is the reporting twin that `doctor` uses to name the
 * file and the parse error a user would otherwise never see.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/** A finite number, or `NaN` when the value does not say one. */
function coerceNumber(value: unknown): number {
	return typeof value === "number"
		? value
		: typeof value === "string" && value.trim() !== ""
			? Number(value)
			: Number.NaN;
}

/**
 * Round a numeric value into `[min, max]`, falling back when it is not a number.
 *
 * Only a number, or a string that says one, counts: `null`, `""`, `true`, and
 * arrays mean "unset". Coercing those would silently clamp to `min` instead of
 * leaving the caller's default in place.
 */
export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	const number = coerceNumber(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * Clamp a numeric value into `[min, max]` without rounding it.
 *
 * Same coercion as {@link clampInteger}; use this for a fractional value such as
 * a per-token rate, where rounding would destroy the decimals.
 */
export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	const number = coerceNumber(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, number));
}

/** A trimmed non-empty string, or the fallback. */
export function cleanString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * `value` when it is a plain object, otherwise `undefined`.
 *
 * A JSON config field is untrusted input: this narrows it to an object without
 * throwing on an array, `null`, or a primitive, so "unset" stays distinct from
 * an empty object. `readJson` applies the same check to the top-level document;
 * use this for a nested field.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

/** Parse a JSON object from disk, ignoring missing/malformed/non-object files. */
export function readJson(path: string): Record<string, unknown> | undefined {
	const result = readJsonResult(path);
	return result.state === "ok" ? result.value : undefined;
}

/** What {@link readJsonResult} found: nothing, a usable object, or why not. */
export type JsonReadResult =
	| { state: "absent" }
	| { state: "ok"; value: Record<string, unknown> }
	| { state: "error"; error: string };

/**
 * Parse a JSON object from disk without swallowing the reason it failed.
 *
 * `absent` covers a missing path; `error` distinguishes a file that exists but
 * is unreadable, not JSON, or not a JSON object — the cases {@link readJson}
 * hides from the extension that asked for it.
 */
export function readJsonResult(path: string): JsonReadResult {
	let text: string;
	try {
		if (!existsSync(path)) return { state: "absent" };
		text = readFileSync(path, "utf-8");
	} catch (error) {
		return { state: "error", error: error instanceof Error ? error.message : String(error) };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return { state: "error", error: error instanceof Error ? error.message : String(error) };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { state: "error", error: "expected a JSON object at the top level" };
	}
	return { state: "ok", value: parsed as Record<string, unknown> };
}

/**
 * Load an effective config: `base`, then the global file, then the project file.
 * `normalize` validates/clamps the merged object over the running base.
 * `agentDir` defaults to Pi's agent directory; `worktree` resolves it explicitly.
 */
export function loadConfigFile<T>(
	cwd: string,
	fileName: string,
	base: T,
	normalize: (raw: Record<string, unknown> | undefined, base: T) => T,
	agentDir: string = getAgentDir(),
): T {
	let config = base;
	config = normalize(readJson(join(agentDir, fileName)), config);
	config = normalize(readJson(join(cwd, CONFIG_DIR_NAME, fileName)), config);
	return config;
}

// --- The shared document ----------------------------------------------------

/** The one JSON file every extension reads: `bytefly.json`. */
export const SHARED_CONFIG_FILE = "bytefly.json";

/** A top-level section of a config document, or `undefined` when it is absent or not an object. */
export function configSection(
	raw: Record<string, unknown> | undefined,
	key: string,
): Record<string, unknown> | undefined {
	return asRecord(raw?.[key]);
}

/**
 * The value at `path` in a document or section, or `undefined` when a step is
 * absent or not an object. A one-element path reads a top-level key, so this
 * also answers "is this setting stated here" for the flat case. `raw` may be an
 * untrusted JSON value or an already-normalized config object.
 */
export function configValueAt(raw: unknown, path: readonly string[]): unknown {
	let current: unknown = raw;
	for (const key of path) {
		const record = asRecord(current);
		if (!record) return undefined;
		current = record[key];
	}
	return current;
}

/** Options for {@link loadConfigSection}. */
export interface SectionOptions {
	/** Agent directory override; `worktree` resolves it explicitly. */
	agentDir?: string;
}

/**
 * Load one top-level section of the shared document: `base`, then the global
 * file's section, then the project file's section. Each later layer is
 * normalized over the previous, so a normalizer's own merge rules (such as
 * `rates` key by key) still hold.
 */
export function loadConfigSection<T>(
	cwd: string,
	section: string,
	base: T,
	normalize: (raw: Record<string, unknown> | undefined, base: T) => T,
	options: SectionOptions = {},
): T {
	return loadConfigFile(
		cwd,
		SHARED_CONFIG_FILE,
		base,
		(raw, running) => normalize(configSection(raw, section), running),
		options.agentDir,
	);
}

/**
 * Merge `value` under `section` in the document at `path`, preserving every
 * other section and top-level key. Creates the file and its directory.
 */
export function writeConfigSection(path: string, section: string, value: unknown): void {
	const document = readJson(path) ?? {};
	document[section] = value;
	writeConfigFile(path, document);
}

/**
 * Read the document a per-key edit targets.
 *
 * A malformed document is refused rather than replaced: the edit came from a
 * row that would otherwise write over content it could not parse, and the
 * caller reports the reason. A missing file is a new document.
 */
function readEditableDocument(path: string): Record<string, unknown> {
	const result = readJsonResult(path);
	if (result.state === "error") throw new Error(`Cannot update ${path}: ${result.error}`);
	return result.state === "ok" ? result.value : {};
}

/**
 * Set one key in one top-level section, preserving every sibling key, every
 * other section, and document metadata (`$schema`, `version`, unknown keys).
 * Creates the file and the section when they are absent. Refuses to rewrite a
 * malformed document.
 */
export function writeConfigValue(path: string, section: string, key: string, value: unknown): void {
	writeConfigValueAt(path, section, [key], value);
}

/**
 * Set the leaf at `keyPath` in one top-level section, with the same guarantees
 * as {@link writeConfigValue}: siblings, other sections, and metadata survive,
 * and the file and the section are created when absent. Intermediate objects
 * are created as needed; a non-object in the way is replaced, because a refused
 * edit would leave a hand-written typo unfixable from the screen. Refuses a
 * malformed document and an empty path.
 */
export function writeConfigValueAt(path: string, section: string, keyPath: readonly string[], value: unknown): void {
	if (keyPath.length === 0) throw new Error(`Cannot update ${path}: empty key path`);
	const document = readEditableDocument(path);
	const current = configSection(document, section) ?? {};
	document[section] = setPath(current, keyPath, value);
	writeConfigFile(path, document);
}

/** Copy `source` with the leaf at `path` replaced; every sibling key is kept. */
function setPath(source: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown> {
	const [head] = path;
	const next = { ...source };
	if (head === undefined) return next;
	if (path.length === 1) {
		next[head] = value;
		return next;
	}
	next[head] = setPath(asRecord(source[head]) ?? {}, path.slice(1), value);
	return next;
}

/**
 * Delete one key from one top-level section, preserving its siblings and the
 * rest of the document. An emptied section is removed rather than left as `{}`.
 * A no-op when the file, section, or key is absent; refuses a malformed
 * document.
 */
export function unsetConfigValue(path: string, section: string, key: string): void {
	const result = readJsonResult(path);
	if (result.state === "absent") return;
	if (result.state === "error") throw new Error(`Cannot update ${path}: ${result.error}`);

	const document = result.value;
	const current = configSection(document, section);
	if (!current || !(key in current)) return;

	const next = { ...current };
	delete next[key];
	if (Object.keys(next).length === 0) delete document[section];
	else document[section] = next;
	writeConfigFile(path, document);
}

/** Write a whole config document atomically (sibling temp file, then rename). */
export function writeConfigFile(path: string, document: Record<string, unknown>): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
	renameSync(temp, path);
}
