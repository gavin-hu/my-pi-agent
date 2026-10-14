/**
 * The `notify` section of the shared `bytefly.json`: defaults, validation, and
 * loader.
 *
 * Read from the top-level `notify` section of `~/.pi/agent/bytefly.json` and
 * `<cwd>/.pi/bytefly.json` (project values override global) through the shared
 * `loadConfigSection`.
 * Missing or malformed documents are ignored, and a value of the wrong type
 * falls back to its default instead of throwing.
 *
 * The capability is **off by default** (`enabled: false`): an OS notification
 * on every completed turn is intrusive unless the user asked for it. Turning it
 * on is the whole configuration needed for unattended runs; the per-trigger
 * flags then narrow what is announced.
 */

import { cleanString, loadConfigSection } from "../../../lib/config.ts";
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

/** Validate the `notify` section over `base`. Total: never throws, never guesses. */
export function normalizeNotifyConfig(raw: Record<string, unknown> | undefined, base: NotifyConfig): NotifyConfig {
	if (!raw) return base;
	return {
		enabled: bool(raw.enabled, base.enabled),
		turnFinished: bool(raw.turnFinished, base.turnFinished),
		needsInput: bool(raw.needsInput, base.needsInput),
		jobFinished: bool(raw.jobFinished, base.jobFinished),
		method: method(raw.method, base.method),
		title: cleanString(raw.title, base.title).slice(0, MAX_TITLE_LENGTH),
	};
}

/** Effective notify config for `cwd` (defaults, then the shared `notify` section, then env). */
export function loadNotifyConfig(cwd: string): NotifyConfig {
	return loadConfigSection(cwd, "notify", DEFAULT_NOTIFY_CONFIG, normalizeNotifyConfig);
}
