/**
 * Configuration for the `file-read` extension.
 *
 * `formats` defaults are derived from the format registry, so a new format needs
 * no config edit. The `file-read` section of the shared `bytefly.json` is read
 * from the global document and the project document (project wins), and every
 * field is clamped.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";
import { FORMATS, type FormatId } from "./formats.ts";

export interface ReadConfig {
	/** Reject files larger than this many bytes. */
	maxFileBytes: number;
	/** Default character budget for the returned slice. */
	maxChars: number;
	/** Per-call extraction deadline; a parser that outlasts it is abandoned. */
	extractTimeoutMs: number;
	/** Per-format on/off, merged over each registry entry's `defaultEnabled`. */
	formats: Record<FormatId, boolean>;
}

export const DEFAULT_CONFIG: ReadConfig = {
	maxFileBytes: 20 * 1024 * 1024,
	maxChars: 40_000,
	extractTimeoutMs: 30_000,
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
export function normalizeConfig(
	raw: Record<string, unknown> | undefined,
	base: ReadConfig = DEFAULT_CONFIG,
): ReadConfig {
	if (!raw) return base;
	return {
		maxFileBytes: clampInteger(raw.maxFileBytes, base.maxFileBytes, 1_024, 512 * 1024 * 1024),
		maxChars: clampInteger(raw.maxChars, base.maxChars, 200, 100_000),
		extractTimeoutMs: clampInteger(raw.extractTimeoutMs, base.extractTimeoutMs, 1_000, 300_000),
		formats: normalizeFormats(raw.formats, base.formats),
	};
}

/** Effective config from the shared `file-read` section (defaults, global, project, env). */
export function loadConfig(cwd: string): ReadConfig {
	return loadConfigSection(cwd, "file-read", DEFAULT_CONFIG, normalizeConfig);
}

/** Whether a format is enabled in the effective config. */
export function isFormatEnabled(config: ReadConfig, id: FormatId): boolean {
	return config.formats[id] !== false;
}
