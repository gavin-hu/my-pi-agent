/**
 * Configuration for the `document` extension.
 *
 * `formats` defaults are derived from the format registry, so a new format needs
 * no config edit. Project `<cwd>/.pi/document.json` values merge over global
 * `~/.pi/agent/document.json` values, and every field is clamped.
 */

import { clampInteger, loadConfigFile } from "../../lib/config.ts";
import { FORMATS, type FormatId } from "./formats.ts";

export interface DocConfig {
	/** Reject files larger than this many bytes. */
	maxFileBytes: number;
	/** Default character budget for the returned slice. */
	maxChars: number;
	/** Per-format on/off, merged over each registry entry's `defaultEnabled`. */
	formats: Record<FormatId, boolean>;
}

export const DEFAULT_CONFIG: DocConfig = {
	maxFileBytes: 20 * 1024 * 1024,
	maxChars: 40_000,
	formats: Object.fromEntries(FORMATS.map((format) => [format.id, format.defaultEnabled])) as Record<FormatId, boolean>,
};

const KNOWN_FORMATS = new Set<string>(FORMATS.map((format) => format.id));

function normalizeFormats(raw: unknown, base: Record<FormatId, boolean>): Record<FormatId, boolean> {
	const formats = { ...base };
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
			if (KNOWN_FORMATS.has(key) && typeof value === "boolean") formats[key as FormatId] = value;
		}
	}
	return formats;
}

/** Validate and clamp a raw config object over the running base. */
export function normalizeConfig(raw: Record<string, unknown> | undefined, base: DocConfig = DEFAULT_CONFIG): DocConfig {
	if (!raw) return base;
	return {
		maxFileBytes: clampInteger(raw.maxFileBytes, base.maxFileBytes, 1_024, 512 * 1024 * 1024),
		maxChars: clampInteger(raw.maxChars, base.maxChars, 200, 100_000),
		formats: normalizeFormats(raw.formats, base.formats),
	};
}

/** Effective config: global file, then project file, over the defaults. */
export function loadConfig(cwd: string): DocConfig {
	return loadConfigFile(cwd, "document.json", DEFAULT_CONFIG, normalizeConfig);
}

/** Whether a format is enabled in the effective config. */
export function isFormatEnabled(config: DocConfig, id: FormatId): boolean {
	return config.formats[id] !== false;
}
