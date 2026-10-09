/**
 * Configuration for the serve extension.
 *
 * Merged from ~/.pi/agent/file-browser.json (global) and
 * <cwd>/.pi/file-browser.json (project). Project values win. Everything is
 * validated and clamped so a typo
 * cannot produce a nonsensical server.
 */

import { randomInt } from "node:crypto";
import { clampInteger, loadConfigFile } from "../../lib/config.ts";

export interface ServeConfig {
	/** TCP port on 127.0.0.1; `0` picks one random port fixed for the session, a positive value pins it. */
	port: number;
	/** Open the default browser when the server starts. */
	autoOpen: boolean;
	/** Files larger than this are not rendered inline. */
	maxFileBytes: number;
	/** Images larger than this get an icon instead of a thumbnail. */
	maxThumbBytes: number;
	/** Lines rendered before a text file is truncated on the page. */
	maxTextLines: number;
	/** Directory entries listed before the listing is truncated. */
	maxDirEntries: number;
	/** Render inline image thumbnails in listings. */
	thumbnails: boolean;
}

export const DEFAULT_CONFIG: ServeConfig = {
	port: 0,
	autoOpen: true,
	maxFileBytes: 1024 * 1024,
	maxThumbBytes: 5 * 1024 * 1024,
	maxTextLines: 5000,
	maxDirEntries: 2000,
	thumbnails: true,
};

/** Base of the per-session port range. */
export const PORT_BASE = 4780;

/** Number of ports in the per-session range. */
export const PORT_RANGE = 1000;

/** A random port in the per-session range `PORT_BASE`–`PORT_BASE + PORT_RANGE - 1`. */
export function randomPort(): number {
	return PORT_BASE + randomInt(PORT_RANGE);
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** Validate and clamp a raw config object over the defaults. */
export function normalizeConfig(
	raw: Record<string, unknown> | undefined,
	base: ServeConfig = DEFAULT_CONFIG,
): ServeConfig {
	if (!raw) return base;
	return {
		port: clampInteger(raw.port, base.port, 0, 65535),
		autoOpen: bool(raw.autoOpen, base.autoOpen),
		maxFileBytes: clampInteger(raw.maxFileBytes, base.maxFileBytes, 0, 1024 * 1024 * 1024),
		maxThumbBytes: clampInteger(raw.maxThumbBytes, base.maxThumbBytes, 0, 1024 * 1024 * 1024),
		maxTextLines: clampInteger(raw.maxTextLines, base.maxTextLines, 1, 1_000_000),
		maxDirEntries: clampInteger(raw.maxDirEntries, base.maxDirEntries, 1, 1_000_000),
		thumbnails: bool(raw.thumbnails, base.thumbnails),
	};
}

/** Load the effective config for a working directory. */
export function loadConfig(cwd: string): ServeConfig {
	return loadConfigFile(cwd, "file-browser.json", DEFAULT_CONFIG, normalizeConfig);
}
