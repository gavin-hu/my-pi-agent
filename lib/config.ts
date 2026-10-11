/**
 * Config-file helpers shared by extensions that read `~/.pi/agent/<name>.json`
 * and `<cwd>/.pi/<name>.json`. Project values override global ones; missing or
 * malformed files are ignored.
 *
 * `readJson` stays deliberately lenient: a malformed file must never break a
 * session. `readJsonResult` is the reporting twin that `doctor` uses to name the
 * file and the parse error a user would otherwise never see.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

/** Round a numeric value into `[min, max]`, falling back when not finite. */
export function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.round(number)));
}

/** A trimmed non-empty string, or the fallback. */
export function cleanString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
 */
export function loadConfigFile<T>(
	cwd: string,
	fileName: string,
	base: T,
	normalize: (raw: Record<string, unknown> | undefined, base: T) => T,
): T {
	let config = base;
	config = normalize(readJson(join(getAgentDir(), fileName)), config);
	config = normalize(readJson(join(cwd, CONFIG_DIR_NAME, fileName)), config);
	return config;
}
