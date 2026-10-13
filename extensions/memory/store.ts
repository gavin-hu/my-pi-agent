/**
 * Markdown storage for the memory extension.
 *
 * Two files, one note per bullet: the global store under the agent directory and
 * the project store under the repository root's `.pi/`. Notes are read from
 * bullet lines, and every other line is preserved on write, so the files stay
 * human-editable. Reads are size-capped and refuse a symlinked path; writes are
 * read-modify-write under the host's file-mutation queue and land atomically.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { repoRootFor } from "../../lib/git/index.ts";

/** Largest memory file read into memory, in bytes. */
export const MAX_MEMORY_BYTES = 256 * 1024;

const FILE_NAME = "memory.md";
const HEADER = "<!-- Pi memory: one note per bullet; written by the memory tool and /memory -->";

/** A bullet line's note text. */
const BULLET = /^\s*[-*]\s+(.+?)\s*$/;

export interface MemoryPaths {
	/** Project store path (the repository root's `.pi/memory.md`). */
	project: string;
	/** Global store path (the agent directory's `memory.md`). */
	global: string;
}

/** Project store path for a repository root, or for `cwd` outside a repository. */
export function projectMemoryPath(cwd: string, repoRoot?: string): string {
	return join(repoRoot ?? cwd, CONFIG_DIR_NAME, FILE_NAME);
}

/** Global store path under the agent directory. */
export function globalMemoryPath(): string {
	return join(getAgentDir(), FILE_NAME);
}

/**
 * Resolve both store paths, anchoring the project store at the repository root
 * so notes survive running from a subdirectory and are shared across worktrees.
 */
export async function resolveMemoryPaths(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<MemoryPaths> {
	// Local `rev-parse` is fast; cap it so a stuck call cannot hang startup.
	const root = await repoRootFor(pi, cwd, 5_000);
	return { project: projectMemoryPath(cwd, root), global: globalMemoryPath() };
}

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Read a store file's raw text; missing is empty, symlink and oversize are refused. */
export function readMemoryFile(path: string): string {
	if (isSymlink(path)) throw new Error(`Refusing to use the symlinked memory file: ${path}`);
	if (!existsSync(path)) return "";
	const size = statSync(path).size;
	if (size > MAX_MEMORY_BYTES) {
		throw new Error(`Memory file is ${size} bytes, larger than the ${MAX_MEMORY_BYTES}-byte limit: ${path}`);
	}
	return readFileSync(path, "utf-8");
}

/** Coarse identity of a store file, for cheap change detection. */
export interface MemoryFileStamp {
	mtimeMs: number;
	size: number;
}

/** Freshness stamp for a store file; `undefined` when it is missing or unstattable. */
export function memoryFileStamp(path: string): MemoryFileStamp | undefined {
	try {
		const info = statSync(path);
		return { mtimeMs: info.mtimeMs, size: info.size };
	} catch {
		return undefined;
	}
}

/** Whether two stamps describe the same file state. */
export function sameStamp(a: MemoryFileStamp | undefined, b: MemoryFileStamp | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

/** Note text of every bullet line, sanitized to one terminal-safe line. */
export function parseEntries(content: string): string[] {
	const entries: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const match = BULLET.exec(line);
		if (!match) continue;
		const text = sanitizeLine(match[1]);
		if (text) entries.push(text);
	}
	return entries;
}

export interface FileChange {
	content: string;
	changed: boolean;
	/** The stored note that made `add` a duplicate, when one matched. */
	existing?: string;
}

/**
 * Comparison key for near-duplicate detection: case-folded, whitespace-collapsed
 * (via `sanitizeLine`), and with trailing sentence punctuation removed.
 * Deliberately conservative: it folds only presentation differences (case, runs
 * of whitespace, a trailing `.`/`!`/`?`/`,`/`;`/`:`), never word order, stemming,
 * or internal punctuation, so two distinct facts are never merged.
 */
export function duplicateKey(text: string): string {
	return sanitizeLine(text)
		.toLowerCase()
		.replace(/[.!?,;:]+$/, "")
		.trim();
}

function endWithNewline(text: string): string {
	const trimmed = text.replace(/\n+$/, "");
	return trimmed ? `${trimmed}\n` : "";
}

/**
 * Append a note, unless it is already present — exactly or as a near-duplicate.
 * A duplicate is a no-op that reports the stored note in `existing`, so the
 * caller can point at `update` instead of storing a reworded copy.
 */
export function applyAdd(content: string, entry: string): FileChange {
	const entries = parseEntries(content);
	if (entries.includes(entry)) return { content, changed: false, existing: entry };
	const key = duplicateKey(entry);
	const existing = entries.find((note) => duplicateKey(note) === key);
	if (existing !== undefined) return { content, changed: false, existing };
	const trimmed = content.replace(/\s+$/, "");
	const next = trimmed ? `${trimmed}\n- ${entry}\n` : `${HEADER}\n\n- ${entry}\n`;
	return { content: next, changed: true };
}

/** Remove every bullet whose note matches `entry` exactly. */
export function applyForget(content: string, entry: string): FileChange {
	let changed = false;
	const kept = content.split(/\r?\n/).filter((line) => {
		const match = BULLET.exec(line);
		if (match && sanitizeLine(match[1]) === entry) {
			changed = true;
			return false;
		}
		return true;
	});
	return changed ? { content: endWithNewline(kept.join("\n")), changed: true } : { content, changed: false };
}

/** Bullet line as marker, note, and trailing whitespace. */
const BULLET_PARTS = /^(\s*[-*]\s+)(.+?)(\s*)$/;

/** Replace every bullet whose note matches `from` exactly, keeping marker and prose. */
export function applyUpdate(content: string, from: string, to: string): FileChange {
	if (from === to) return { content, changed: false };
	let changed = false;
	const lines = content.split(/\r?\n/).map((line) => {
		const match = BULLET_PARTS.exec(line);
		if (!match || sanitizeLine(match[2]) !== from) return line;
		changed = true;
		return `${match[1]}${to}${match[3]}`;
	});
	return changed ? { content: lines.join("\n"), changed: true } : { content, changed: false };
}

/** Remove every note, keeping the header and any prose. */
export function applyClear(content: string): FileChange {
	let changed = false;
	const kept = content.split(/\r?\n/).filter((line) => {
		if (BULLET.test(line)) {
			changed = true;
			return false;
		}
		return true;
	});
	if (!changed) return { content, changed: false };
	const body = kept
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return { content: body ? endWithNewline(body) : `${HEADER}\n`, changed: true };
}

function writeAtomic(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.tmp`;
	writeFileSync(temp, content, "utf-8");
	renameSync(temp, path);
}

export interface MutationResult {
	entries: string[];
	changed: boolean;
	/** The stored note an `add` matched, when the transform reported a duplicate. */
	existing?: string;
}

/**
 * Apply a content transform to `path` as one read-modify-write under the host's
 * file-mutation queue, so concurrent writers for the same file serialize.
 */
export async function mutateMemoryFile(
	path: string,
	transform: (content: string) => FileChange,
): Promise<MutationResult> {
	return withFileMutationQueue(path, async () => {
		const result = transform(readMemoryFile(path));
		if (result.changed) writeAtomic(path, result.content);
		const entries = parseEntries(result.content);
		return result.existing === undefined
			? { entries, changed: result.changed }
			: { entries, changed: result.changed, existing: result.existing };
	});
}
