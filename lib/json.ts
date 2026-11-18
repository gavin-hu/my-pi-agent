/**
 * The JSON boundary shared by extensions: an untrusted value narrowed to what
 * the caller declared, and a document read or written on disk.
 *
 * A config field, a wire payload, or a child process's output is untrusted, so
 * a number, a boolean, a list, or an object here is only one when it is one and
 * the caller's fallback answers otherwise. On disk the same boundary is
 * lenient on the way in — `readJson` ignores what is missing or malformed, and
 * `readJsonResult` is the reporting twin that names the file and the parse
 * error a user would otherwise never see — and atomic on the way out: `writeTextAtomic`
 * publishes a file by a rename, and `writeJsonFile` is its JSON face, so a reader sees
 * the old document or the new one. A markdown store uses the text half directly.
 *
 * Nothing here knows what a document means. The `bytefly.json` document that
 * layers sections, leaves, and metadata over these functions is `config.ts`,
 * so a caller that only clamps a number loads none of it.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

/** A trimmed non-empty string, or `undefined` when the value is unset or blank. */
export function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A boolean, or the fallback when the value is anything else. */
export function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** Kept trimmed, non-empty strings from an untrusted array, or the fallback. */
export function stringList(value: unknown, fallback: string[]): string[] {
	if (!Array.isArray(value)) return fallback;
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

/**
 * The value one table holds, or nothing when it holds none.
 *
 * The narrowest member of this boundary and the one a tool leans on hardest: a model sends a verb
 * as a string, and the tool holds the verbs in a table — the same table its parameter schema is
 * built from — so a value outside it is refused rather than guessed at. The default a caller wants
 * for an absent value stays the caller's, because which one that is a fact about the tool: the bus
 * reads a missing kind as `message`, and the board has no default action at all.
 */
export function memberOf<const Values extends readonly string[]>(
	values: Values,
	value: unknown,
): Values[number] | undefined {
	return typeof value === "string" && (values as readonly string[]).includes(value)
		? (value as Values[number])
		: undefined;
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

/**
 * A finite number from an untrusted JSON field, or `undefined`.
 *
 * The numeric companion to {@link asRecord}: a field a wire format, a child
 * process, or a config file claims is a number is only a number when it is one —
 * a string, `NaN`, or `null` reads as "not reported" so a caller can fall back
 * instead of summing garbage into a total.
 */
export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Parse a JSON object from disk, ignoring missing/malformed/non-object files. */
export function readJson(path: string): Record<string, unknown> | undefined {
	const result = readJsonResult(path);
	return result.state === "ok" ? result.value : undefined;
}

/** How the written file is shaped: the mode a caller keeps private, and nothing else. */
export interface AtomicWriteOptions {
	/** File mode for the published file, applied to the temp file the rename publishes. */
	mode?: number;
}

/**
 * The temp name an atomic write publishes from: a sibling of the target carrying this
 * process's id and fresh randomness.
 *
 * Two processes never share a name, and two writes in one process never share one either
 * — a session that writes its record twice in one tick is the case the pid alone cannot
 * answer. Exported for {@link writeTextAtomic} and for the case that holds it: a caller
 * that builds a name must also publish and clean it up, so nothing else calls this.
 */
export function tempPathFor(path: string): string {
	return `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
}

/**
 * Write `text` at `path`, replacing whatever is there in one rename.
 *
 * A plain truncating write leaves the file empty and half-written for as long as the
 * write takes, and a reader that lands there parses nothing — defaults for a config
 * file, "not logged in" for `wechat`'s credentials, no notes for a memory store. The
 * rename is the publish: a reader sees the old document or the new one, never a
 * fragment, and never another writer's temp under this one's name.
 *
 * The mode rides on the temp file and is set again after the create, so a `0600` file is
 * never readable at a wider mode for even a moment, and a umask cannot narrow it to
 * something the owner cannot read back; the published name inherits it through the rename.
 *
 * A write or rename that fails removes its temp, so the next write is not handed the
 * broken one's name and nothing is left beside the target.
 */
export function writeTextAtomic(path: string, text: string, options: AtomicWriteOptions = {}): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = tempPathFor(path);
	try {
		if (options.mode === undefined) writeFileSync(temp, text, "utf-8");
		else {
			writeFileSync(temp, text, { encoding: "utf-8", mode: options.mode });
			chmodSync(temp, options.mode);
		}
		renameSync(temp, path);
	} catch (error) {
		try {
			rmSync(temp, { force: true });
		} catch {
			// The failure that brought us here is the one worth reporting.
		}
		throw error;
	}
}

/**
 * Write `value` as JSON at `path`: one document, published by {@link writeTextAtomic}.
 *
 * A value JSON has no form for is refused: `JSON.stringify` answers `undefined` for it,
 * and written out that is the five letters, which the next reader loads as an empty
 * document.
 */
export function writeJsonFile(path: string, value: unknown, options: AtomicWriteOptions = {}): void {
	const body = JSON.stringify(value, null, 2);
	if (body === undefined) throw new TypeError(`writeJsonFile: ${path} has no JSON form`);
	writeTextAtomic(path, `${body}\n`, options);
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
