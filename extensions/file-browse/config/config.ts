/**
 * Configuration for the browse extension.
 *
 * The `file-browse` section of the shared `bytefly.json` (global then project,
 * project wins). Everything
 * is validated and clamped so a typo cannot produce a nonsensical server.
 */

import { randomInt } from "node:crypto";
import { asBoolean, clampInteger, loadConfigSection } from "../../../lib/config.ts";

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
	/** Render Markdown files as formatted HTML instead of plain text. */
	markdown: boolean;
	/** Re-emit sanitized raw HTML inside rendered Markdown; false escapes it as text. */
	markdownHtml: boolean;
	/** Files collected for the quick-open index before it is truncated. */
	maxIndexEntries: number;
	/** Offer the read-only git diff view. */
	gitDiff: boolean;
	/** Unified diff context lines. */
	diffContext: number;
	/** Diff lines rendered before the view is truncated. */
	maxDiffLines: number;
	/** Push live status to open pages over `/events`. */
	live: boolean;
	/** How often a connected page is sent a status frame, in ms. */
	liveIntervalMs: number;
}

export const DEFAULT_CONFIG: ServeConfig = {
	port: 0,
	autoOpen: true,
	maxFileBytes: 1024 * 1024,
	maxThumbBytes: 5 * 1024 * 1024,
	maxTextLines: 5000,
	maxDirEntries: 2000,
	thumbnails: true,
	markdown: true,
	markdownHtml: true,
	maxIndexEntries: 20000,
	gitDiff: true,
	diffContext: 3,
	maxDiffLines: 4000,
	live: true,
	liveIntervalMs: 5000,
};

/** Base of the per-session port range. */
export const PORT_BASE = 4780;

/** Number of ports in the per-session range. */
export const PORT_RANGE = 1000;

/** Fastest live-status cadence a page may be given: short enough to watch, and a
 * floor so a page cannot outrun the git reads behind each frame. */
export const LIVE_INTERVAL_MIN = 250;

/** Slowest live-status cadence, so a page cannot look abandoned. */
export const LIVE_INTERVAL_MAX = 60_000;

/**
 * How long the server keeps listening once the last page has gone. A reload or a
 * navigation detaches the stream and re-attaches within a moment, so the grace has
 * to outlast one; a closed window never re-attaches, and the port is released
 * instead of listening for nobody until the session ends.
 */
export const IDLE_STOP_MS = 10_000;

/**
 * How many pages may hold the status stream at once. One snapshot serves them
 * all, but every attached page keeps the ticker — and the git read behind each
 * frame — running, so a local page cannot open a thousand streams and pin the
 * server alive. The refusal is a `204`, which tells an event source to stop
 * reconnecting instead of retrying for a slot that will not open.
 */
export const LIVE_MAX_CLIENTS = 8;

/** A random port in the per-session range `PORT_BASE`–`PORT_BASE + PORT_RANGE - 1`. */
export function randomPort(): number {
	return PORT_BASE + randomInt(PORT_RANGE);
}

/** Validate and clamp a raw config object over the defaults. */
export function normalizeConfig(
	raw: Record<string, unknown> | undefined,
	base: ServeConfig = DEFAULT_CONFIG,
): ServeConfig {
	if (!raw) return base;
	return {
		port: clampInteger(raw.port, base.port, 0, 65535),
		autoOpen: asBoolean(raw.autoOpen, base.autoOpen),
		maxFileBytes: clampInteger(raw.maxFileBytes, base.maxFileBytes, 0, 1024 * 1024 * 1024),
		maxThumbBytes: clampInteger(raw.maxThumbBytes, base.maxThumbBytes, 0, 1024 * 1024 * 1024),
		maxTextLines: clampInteger(raw.maxTextLines, base.maxTextLines, 1, 1_000_000),
		maxDirEntries: clampInteger(raw.maxDirEntries, base.maxDirEntries, 1, 1_000_000),
		thumbnails: asBoolean(raw.thumbnails, base.thumbnails),
		markdown: asBoolean(raw.markdown, base.markdown),
		markdownHtml: asBoolean(raw.markdownHtml, base.markdownHtml),
		maxIndexEntries: clampInteger(raw.maxIndexEntries, base.maxIndexEntries, 1, 1_000_000),
		gitDiff: asBoolean(raw.gitDiff, base.gitDiff),
		diffContext: clampInteger(raw.diffContext, base.diffContext, 0, 100),
		maxDiffLines: clampInteger(raw.maxDiffLines, base.maxDiffLines, 1, 1_000_000),
		live: asBoolean(raw.live, base.live),
		liveIntervalMs: clampInteger(raw.liveIntervalMs, base.liveIntervalMs, LIVE_INTERVAL_MIN, LIVE_INTERVAL_MAX),
	};
}

/** Load the effective config for a working directory. */
export function loadConfig(cwd: string): ServeConfig {
	return loadConfigSection(cwd, "file-browse", DEFAULT_CONFIG, normalizeConfig);
}
