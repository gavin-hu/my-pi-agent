/**
 * Config-file support for keep-awake.
 *
 * Read from `~/.pi/agent/keep-awake.json` and `<cwd>/.pi/keep-awake.json`;
 * project values override global ones, and missing or malformed files are
 * ignored.
 */

import { loadConfigFile } from "../../lib/config.ts";
import type { KeepAwakeConfig, KeepAwakeMode } from "./types.ts";

export const DEFAULT_CONFIG: KeepAwakeConfig = { mode: "auto", keepDisplay: false };

const MODES: readonly KeepAwakeMode[] = ["auto", "always"];

function normalizeMode(value: unknown, fallback: KeepAwakeMode): KeepAwakeMode {
	const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
	return (MODES as readonly string[]).includes(mode) ? (mode as KeepAwakeMode) : fallback;
}

/** Validate a raw config object over `base`. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: KeepAwakeConfig): KeepAwakeConfig {
	if (!raw) return base;
	return {
		mode: normalizeMode(raw.mode, base.mode),
		keepDisplay: typeof raw.keepDisplay === "boolean" ? raw.keepDisplay : base.keepDisplay,
	};
}

/** Effective keep-awake config for `cwd` (global file, then project file, over defaults). */
export function loadConfig(cwd: string): KeepAwakeConfig {
	return loadConfigFile(cwd, "keep-awake.json", DEFAULT_CONFIG, normalizeConfig);
}
