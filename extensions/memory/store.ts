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
import { sanitize, stripControlChars } from "../../lib/format.ts";
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

/** Note text of every bullet line, sanitized to one terminal-safe line. */
export function parseEntries(content: string): string[] {
	const entries: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const match = BULLET.exec(line);
		if (!match) continue;
		const text = sanitize(stripControlChars(match[1]));
		if (text) entries.push(text);
	}
	return entries;
}

export interface FileChange {
	content: string;
	changed: boolean;
}

function endWithNewline(text: string): string {
	const trimmed = text.replace(/\n+$/, "");
	return trimmed ? `${trimmed}\n` : "";
}

/** Append a note, unless it is already present. */
export function applyAdd(content: string, entry: string): FileChange {
	if (parseEntries(content).includes(entry)) return { content, changed: false };
	const trimmed = content.replace(/\s+$/, "");
	const next = trimmed ? `${trimmed}\n- ${entry}\n` : `${HEADER}\n\n- ${entry}\n`;
	return { content: next, changed: true };
}

/** Remove every bullet whose note matches `entry` exactly. */
export function applyForget(content: string, entry: string): FileChange {
	let changed = false;
	const kept = content.split(/\r?\n/).filter((line) => {
		const match = BULLET.exec(line);
		if (match && sanitize(stripControlChars(match[1])) === entry) {
			changed = true;
			return false;
		}
		return true;
	});
	return changed ? { content: endWithNewline(kept.join("\n")), changed: true } : { content, changed: false };
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
		return { entries: parseEntries(result.content), changed: result.changed };
	});
}
