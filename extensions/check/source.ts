/**
 * Read a small source excerpt around a parsed failure's location.
 *
 * The path comes from command output, so it is treated as untrusted: it must
 * resolve inside the project root (including through symlinks), be a regular
 * file, and pass a size/NUL check before any text is returned. Anything else
 * is a reason the detail pane can show while it falls back to the run tail.
 */

import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { isInside, isInsideReal } from "../../lib/path.ts";
import type { Failure } from "./types.ts";

/** Lines shown before and after the target line. */
export const SOURCE_CONTEXT = 5;

/** Largest source file read for a detail pane. */
export const MAX_SOURCE_BYTES = 512 * 1024;

export interface SourceExcerpt {
	/** 1-based line number of the first returned row. */
	startLine: number;
	/** 1-based line number of the last returned row. */
	endLine: number;
	/** 1-based target line. */
	targetLine: number;
	/** Raw file lines, one per row, without line numbers or markers. */
	lines: string[];
}

export type SourceResult = { ok: true; excerpt: SourceExcerpt } | { ok: false; reason: string };

/** A source excerpt for a failure, or the reason one cannot be shown. */
export function readSourceExcerpt(cwd: string, failure: Failure): SourceResult {
	if (!failure.path) return { ok: false, reason: "no file location" };
	if (failure.line === undefined || !Number.isFinite(failure.line) || failure.line < 1) {
		return { ok: false, reason: "no line number" };
	}

	const root = resolve(cwd);
	const absolute = isAbsolute(failure.path) ? resolve(failure.path) : resolve(root, failure.path);
	if (!isInside(root, absolute) || !isInsideReal(root, absolute)) {
		return { ok: false, reason: "outside the project" };
	}

	let stat;
	try {
		stat = statSync(absolute);
	} catch {
		return { ok: false, reason: "file is missing" };
	}
	if (!stat.isFile()) return { ok: false, reason: "not a regular file" };
	if (stat.size > MAX_SOURCE_BYTES) return { ok: false, reason: "file is too large" };

	let text: string;
	try {
		text = readFileSync(absolute, "utf-8");
	} catch {
		return { ok: false, reason: "file could not be read" };
	}
	if (text.includes("\u0000")) return { ok: false, reason: "binary file" };

	const fileLines = text.split(/\r?\n/);
	if (failure.line > fileLines.length) {
		return { ok: false, reason: `line ${failure.line} is outside the file (${fileLines.length} lines)` };
	}

	const startLine = Math.max(1, failure.line - SOURCE_CONTEXT);
	const endLine = Math.min(fileLines.length, failure.line + SOURCE_CONTEXT);
	return {
		ok: true,
		excerpt: {
			startLine,
			endLine,
			targetLine: failure.line,
			lines: fileLines.slice(startLine - 1, endLine),
		},
	};
}
