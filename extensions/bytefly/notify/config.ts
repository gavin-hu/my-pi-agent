/**
 * The `notify` section of `bytefly.json`: defaults, validation, and loader.
 *
 * Read from `~/.pi/agent/bytefly.json` and `<cwd>/.pi/bytefly.json` (project
 * values override global) through the shared `loadConfigFile`, exactly like the
 * footer's price section does for the other keys of the same file. Missing or
 * malformed files are ignored, and a value of the wrong type falls back to its
 * default instead of throwing.
 *
 * The capability is **off by default** (`enabled: false`): an OS notification
 * on every completed turn is intrusive unless the user asked for it. Turning it
 * on is the whole configuration needed for unattended runs; the per-trigger
 * flags then narrow what is announced.
 */

import { asRecord, cleanString, loadConfigFile } from "../../../lib/config.ts";
import { BYTEFLY_CONFIG_FILE } from "../config.ts";
import { NOTIFY_METHODS, type NotifyConfig, type NotifyMethod } from "./types.ts";

/** A notification title longer than this is clamped; it is a label, not a message. */
const MAX_TITLE_LENGTH = 40;

export const DEFAULT_NOTIFY_CONFIG: NotifyConfig = {
	enabled: false,
	turnFinished: true,
	needsInput: true,
	jobFinished: true,
	method: "auto",
	title: "Pi",
};

/** A boolean, or the fallback. */
function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** One of the known methods, or the fallback. */
function method(value: unknown, fallback: NotifyMethod): NotifyMethod {
	return typeof value === "string" && (NOTIFY_METHODS as readonly string[]).includes(value)
		? (value as NotifyMethod)
		: fallback;
}

/** Validate the `notify` object over `base`. Total: never throws, never guesses. */
export function normalizeNotifyConfig(raw: Record<string, unknown> | undefined, base: NotifyConfig): NotifyConfig {
	const value = asRecord(raw?.notify);
	if (!value) return base;
	return {
		enabled: bool(value.enabled, base.enabled),
		turnFinished: bool(value.turnFinished, base.turnFinished),
		needsInput: bool(value.needsInput, base.needsInput),
		jobFinished: bool(value.jobFinished, base.jobFinished),
		method: method(value.method, base.method),
		title: cleanString(value.title, base.title).slice(0, MAX_TITLE_LENGTH),
	};
}

/** Effective notify config for `cwd` (defaults, then the global file, then the project file). */
export function loadNotifyConfig(cwd: string): NotifyConfig {
	return loadConfigFile(cwd, BYTEFLY_CONFIG_FILE, DEFAULT_NOTIFY_CONFIG, normalizeNotifyConfig);
}
