/**
 * The JSON boundary shared by extensions: an untrusted value narrowed to what
 * the caller declared, and a document read or written on disk.
 *
 * A config field, a wire payload, or a child process's output is untrusted, so
 * a number, a boolean, a list, or an object here is only one when it is one and
 * the caller's fallback answers otherwise. On disk the same boundary is
 * lenient on the way in — `readJson` ignores what is missing or malformed, and
 * `readJsonResult` is the reporting twin that names the file and the parse
 * error a user would otherwise never see — and atomic on the way out: the write
 * is published by a rename, so a reader sees the old document or the new one.
 *
 * Nothing here knows what a document means. The `bytefly.json` document that
 * layers sections, leaves, and metadata over these functions is `config.ts`,
 * so a caller that only clamps a number loads none of it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

/** How the written document is shaped: one JSON object, indented, newline-terminated. */
export interface JsonWriteOptions {
	/** File mode for the written file, applied to the temp file the rename publishes. */
	mode?: number;
}

/**
 * Write `value` as JSON at `path`, replacing whatever is there in one rename.
 *
 * A plain truncating write leaves the file empty and half-written for as long as the
 * write takes, and a reader that lands there parses nothing — defaults for a config
 * file, "not logged in" for `wechat`'s credentials. The rename is the publish: a
 * reader sees the old document or the new one, never a fragment. The pid suffix is
 * what keeps two processes from sharing one temp name.
 *
 * The mode rides on the temp file rather than being applied after the write, so a
 * `0600` file is never readable at a wider mode for even a moment.
 *
 * A value JSON has no form for is refused: `JSON.stringify` answers `undefined` for it,
 * and written out that is the five letters, which the next reader loads as an empty
 * document. A write or rename that fails removes its temp, so the next write is not
 * handed the broken one's name.
 */
export function writeJsonFile(path: string, value: unknown, options: JsonWriteOptions = {}): void {
	const body = JSON.stringify(value, null, 2);
	if (body === undefined) throw new TypeError(`writeJsonFile: ${path} has no JSON form`);
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	const text = `${body}\n`;
	try {
		if (options.mode === undefined) writeFileSync(temp, text, "utf-8");
		else writeFileSync(temp, text, { encoding: "utf-8", mode: options.mode });
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
