/**
 * Config-file helpers shared by extensions that read `~/.pi/agent/<name>.json`
 * and `<cwd>/.pi/<name>.json`. Project values override global ones; missing or
 * malformed files are ignored.
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
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
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
