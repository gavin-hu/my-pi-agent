/**
 * Markdown storage for the memory extension.
 *
 * Two files, one note per bullet: the global store under the agent directory and
 * the project store under the repository root's `.pi/`. Notes are read from
 * bullet lines, and every other line is preserved on write, so the files stay
 * human-editable. Reads are size-capped and refuse a symlinked path; writes are
 * read-modify-write under the host's file-mutation queue and land through the one
 * atomic write in `lib/json.ts`, whose temp name is per process and per write.
 */

import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "../../lib/format.ts";
import { writeTextAtomic } from "../../lib/json.ts";
import { bytes } from "./format.ts";
import { noteLabel, type MemoryNote, type NoteStamp } from "./types.ts";

/**
 * Largest store Pi will write to, in bytes. A write that grows a store past this is refused
 * and a write that shrinks one always lands, so pruning is the way back from any store.
 */
export const MAX_STORE_BYTES = 256 * 1024;

/**
 * Largest file read at all, in bytes: an out-of-memory guard, not a policy.
 *
 * The two ceilings are deliberately different numbers. Conflated, the policy became the
 * guard and a store that reached it could not be read, listed, edited or cleared — while
 * a copy pasted through `/memory edit` was what put it there. A store between the two is
 * readable now, which is how one that grew outside Pi comes back.
 */
export const MAX_READ_BYTES = 4 * 1024 * 1024;

/** A note is instruction the session trusts, so the store is the owner's alone. */
const FILE_MODE = 0o600;

const FILE_NAME = "memory.md";
const HEADER = "<!-- Pi memory: one note per bullet; written by the memory tool and /memory -->";

/** A bullet line's note text. */
const BULLET = /^\s*[-*]\s+(.+?)\s*$/;

/** Bullet line as marker, note, and trailing whitespace. */
const BULLET_PARTS = /^(\s*[-*]\s+)(.+?)(\s*)$/;

/**
 * The attribution trailer: written last on the bullet, anchored to the end of the line so a
 * `-->` inside a label or a note can never close it early. The label is captured without its
 * surrounding space, and the moment exactly as written.
 */
const TRAILER = /\s*<!--\s*by:\s*(.+?)\s*@\s*(\S+)\s*-->\s*$/;

/** One bullet line as a note, or `undefined` when the line is not a bullet with text. */
function parseNote(line: string): MemoryNote | undefined {
	const match = BULLET_PARTS.exec(line);
	if (!match) return undefined;
	const trailer = TRAILER.exec(match[2]);
	if (!trailer) {
		const text = sanitizeLine(match[2]);
		return text ? { text } : undefined;
	}
	const text = sanitizeLine(match[2].slice(0, trailer.index));
	if (!text) return undefined;
	// A trailer without a label is not one: the note reads as text and keeps its words.
	const by = sanitizeLine(trailer[1]);
	return by ? { text, by, at: trailer[2] } : { text };
}

/** Every note in a store's text, in file order. */
export function parseNotes(content: string): MemoryNote[] {
	const notes: MemoryNote[] = [];
	for (const line of content.split(/\r?\n/)) {
		const note = parseNote(line);
		if (note !== undefined) notes.push(note);
	}
	return notes;
}

/** Note text of every bullet line, sanitized to one terminal-safe line. */
export function parseEntries(content: string): string[] {
	return parseNotes(content).map((note) => note.text);
}

/** The bullet a note is written as, with its trailer when there is a stamp to write. */
function noteLine(note: MemoryNote, marker = "- "): string {
	const trailer = note.by !== undefined && note.at !== undefined ? ` <!-- by: ${note.by} @ ${note.at} -->` : "";
	return `${marker}${note.text}${trailer}`;
}

/** Whether a stored note is the one a caller named: its text, or the label a reader saw. */
function noteIsNamed(note: MemoryNote, named: string): boolean {
	return [note.text, noteLabel(note)].includes(named);
}

/**
 * The label the bus records for a session, or `undefined` when it has no record here.
 *
 * The directory is built here because this is the module that already anchors on the agent
 * directory; a session that never writes a note pays for neither the roster nor the key.
 */
export async function busLabelFor(
	pi: Pick<ExtensionAPI, "exec">,
	sessionId: string,
	cwd: string,
): Promise<string | undefined> {
	const [{ repoKeyFor }, { readRoster }, { BUS_DIR_NAME }] = await Promise.all([
		import("../../lib/repo-key.ts"),
		import("../../lib/session-roster.ts"),
		import("../../lib/session-files.ts"),
	]);
	const dir = join(getAgentDir(), BUS_DIR_NAME, (await repoKeyFor(pi, cwd)).key);
	return (await readRoster(dir))?.find((entry) => entry.id === sessionId)?.label;
}

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
function globalMemoryPath(): string {
	return join(getAgentDir(), FILE_NAME);
}

/**
 * Resolve both store paths, anchoring the project store at the checkout the repository
 * states its settings in.
 *
 * `.pi/` is gitignored, so a worktree's own copy would be a second store that dies with
 * the tree — and the worktree is where the work happens. `settingsRootFor` answers the
 * checkout every worktree of the repository shares, from a subdirectory or a linked
 * worktree alike; outside a repository it answers `cwd`.
 */
export async function resolveMemoryPaths(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<MemoryPaths> {
	// Loaded where it is used: the store read is the first thing a session asks for, and the
	// registration path pays nothing for a resolver that reaches `node:crypto`.
	const { settingsRootFor } = await import("../../lib/repo-key.ts");
	const root = await settingsRootFor(pi, cwd);
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
	if (size > MAX_READ_BYTES) {
		throw new Error(
			`Memory file is ${size} bytes, larger than the ${MAX_READ_BYTES}-byte limit: ${path}. ` +
				"Pi does not write a file this large, so trim or remove it by hand.",
		);
	}
	return readFileSync(path, "utf-8");
}

/**
 * Identity of a store file, for cheap change detection.
 *
 * The stamp is nanoseconds, not milliseconds: an edit that keeps the file's size
 * is otherwise invisible for a whole millisecond, which is long enough for an
 * editor that writes in place. `size` stays a number so the doctor's byte counts
 * read the same.
 */
export interface MemoryFileStamp {
	mtimeNs: bigint;
	size: number;
}

/** Freshness stamp for a store file; `undefined` when it is missing or unstattable. */
export function memoryFileStamp(path: string): MemoryFileStamp | undefined {
	try {
		const info = statSync(path, { bigint: true });
		return { mtimeNs: info.mtimeNs, size: Number(info.size) };
	} catch {
		return undefined;
	}
}

/** Whether two stamps describe the same file state. */
export function sameStamp(a: MemoryFileStamp | undefined, b: MemoryFileStamp | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a.mtimeNs === b.mtimeNs && a.size === b.size;
}

interface FileChange {
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
 * A duplicate is a no-op that reports the stored note in `existing` (as a reader sees it,
 * `[jack] text`), so the caller can point at `update` instead of storing a reworded copy.
 */
export function applyAdd(content: string, entry: string, stamp: NoteStamp = {}): FileChange {
	const notes = parseNotes(content);
	const found = notes.find((note) => noteIsNamed(note, entry));
	if (found !== undefined) return { content, changed: false, existing: noteLabel(found) };
	const key = duplicateKey(entry);
	const near = notes.find((note) => duplicateKey(note.text) === key);
	if (near !== undefined) return { content, changed: false, existing: noteLabel(near) };
	const trimmed = content.replace(/\s+$/, "");
	const line = noteLine({ text: entry, ...stamp });
	const next = trimmed ? `${trimmed}\n${line}\n` : `${HEADER}\n\n${line}\n`;
	return { content: next, changed: true };
}

/** Remove every bullet whose note a caller names, by its text or by `[by] text`. */
export function applyForget(content: string, entry: string): FileChange {
	let changed = false;
	const kept = content.split(/\r?\n/).filter((line) => {
		const note = parseNote(line);
		if (note !== undefined && noteIsNamed(note, entry)) {
			changed = true;
			return false;
		}
		return true;
	});
	return changed ? { content: endWithNewline(kept.join("\n")), changed: true } : { content, changed: false };
}

/**
 * Replace every bullet whose note a caller names with one `to` at the end of the store,
 * keeping the first match's marker and every line of prose.
 *
 * A note's position is its age: `applyAdd` appends, and the injected body keeps the
 * newest notes when its byte cap is hit. An update that stayed where it stood would make
 * a corrected fact the first one the cap drops, which is the opposite of a correction. The
 * trailer is refreshed too: whoever last corrected a note is the one asserting it now.
 */
export function applyUpdate(content: string, from: string, to: string, stamp: NoteStamp = {}): FileChange {
	if (from === to) return { content, changed: false };
	let marker: string | undefined;
	const kept: string[] = [];
	for (const line of content.split(/\r?\n/)) {
		const note = parseNote(line);
		if (note !== undefined && noteIsNamed(note, from)) {
			marker ??= BULLET_PARTS.exec(line)?.[1] ?? "- ";
			continue;
		}
		kept.push(line);
	}
	if (marker === undefined) return { content, changed: false };
	const trimmed = kept.join("\n").replace(/\s+$/, "");
	const line = noteLine({ text: to, ...stamp }, marker);
	return { content: trimmed ? `${trimmed}\n${line}\n` : `${line}\n`, changed: true };
}

/**
 * Merge two notes into one: replace `first` in place with `merged` and drop `second`, so
 * the pair becomes a single bullet where the first one stood. One transform, so the
 * caller's write is atomic; a missing note or two identical names changes nothing. The
 * merging session's stamp replaces both: it is the one asserting the merged text.
 */
export function applyMerge(
	content: string,
	first: string,
	second: string,
	merged: string,
	stamp: NoteStamp = {},
): FileChange {
	if (first === second) return { content, changed: false };
	const lines = content.split(/\r?\n/);
	const notes = lines.map((line) => parseNote(line));
	const named = (value: string) => notes.find((note) => note !== undefined && noteIsNamed(note, value));
	if (named(first) === undefined || named(second) === undefined) return { content, changed: false };

	let changed = false;
	const out: string[] = [];
	for (const line of lines) {
		const note = parseNote(line);
		if (note !== undefined && noteIsNamed(note, first)) {
			const marker = BULLET_PARTS.exec(line)?.[1] ?? "- ";
			out.push(noteLine({ text: merged, ...stamp }, marker));
			changed = true;
			continue;
		}
		if (note !== undefined && noteIsNamed(note, second)) continue;
		out.push(line);
	}

	return changed ? { content: endWithNewline(out.join("\n")), changed: true } : { content, changed: false };
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

/** Owner-only: a store written before the mode was set is still wider than it claims. */
function tightenMode(path: string): void {
	if (existsSync(path) && (statSync(path).mode & 0o777) !== FILE_MODE) chmodSync(path, FILE_MODE);
}

interface MutationResult {
	entries: MemoryNote[];
	changed: boolean;
	/** The stored note an `add` matched, when the transform reported a duplicate. */
	existing?: string;
}

/** The refusal a write gets when it would take a store past its cap. */
function overCapError(path: string, after: number): Error {
	return new Error(
		`The store would reach ${after} bytes, past the ${MAX_STORE_BYTES}-byte cap: ${path}. ` +
			"Prune it first — `clear`, a `forget`, or a shorter `write` still lands.",
	);
}

/**
 * Append one note to a store instead of rewriting it.
 *
 * One `O_APPEND` write is the whole publication: no temp, no rename, no read-modify-write of
 * the store's bytes, so a peer appending at the same instant keeps its line and this one keeps
 * ours. The read before it only decides — is this a duplicate, would the *landed* bytes cross
 * the cap, does an empty file need the header — and a decision that raced is a duplicate note
 * rather than a lost one.
 *
 * The queue is still taken, for a narrower reason than before: it serialises this process's
 * add against its own `forget`/`update`, where a rewrite that read first would otherwise write
 * the store back without the new line.
 *
 * What an append cannot do is tidy: a store with blank lines at its end keeps them, because a
 * rewrite is the only thing that collapses them. The next `forget` or `update` does.
 */
export async function appendMemoryNote(path: string, entry: string, stamp: NoteStamp = {}): Promise<MutationResult> {
	return withFileMutationQueue(path, async () => {
		const content = readMemoryFile(path);
		// The decision, and the one place a note's bullet is built.
		const planned = applyAdd(content, entry, stamp);
		// The view is the file, not our read plus our line: a peer that appended between the two
		// is in the store and belongs in this session's list. A peer that lands after this read
		// is the window every `commit` already carries, whose stamp is taken from the file too.
		const view = () => parseNotes(readMemoryFile(path));
		if (!planned.changed) {
			return planned.existing === undefined
				? { entries: view(), changed: false }
				: { entries: view(), changed: false, existing: planned.existing };
		}
		const prefix = content === "" ? `${HEADER}\n\n` : content.endsWith("\n") ? "" : "\n";
		const suffix = `${prefix}${noteLine({ text: entry, ...stamp })}\n`;
		// What lands, not what the rewrite would have collapsed: trailing blank lines stay.
		const after = bytes(content) + bytes(suffix);
		if (after > MAX_STORE_BYTES) throw overCapError(path, after);
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, suffix, { encoding: "utf-8", mode: FILE_MODE });
		tightenMode(path);
		return { entries: view(), changed: true };
	});
}

/**
 * Apply a content transform to `path` as one read-modify-write under the host's
 * file-mutation queue, so concurrent writers for the same file serialize.
 *
 * The store's ceiling is checked on the transform's **result**, not on the action: a write
 * that grows the store past `MAX_STORE_BYTES` is refused, and a write that shrinks it lands
 * however large it was, so `forget`, `clear` and a trimming edit are always the way back.
 * The refusal names the file and both sizes, because deciding what to prune is the next act.
 */
export async function mutateMemoryFile(
	path: string,
	transform: (content: string) => FileChange,
): Promise<MutationResult> {
	return withFileMutationQueue(path, async () => {
		const content = readMemoryFile(path);
		const result = transform(content);
		if (result.changed) {
			const before = bytes(content);
			const after = bytes(result.content);
			if (after > MAX_STORE_BYTES && after >= before) {
				throw overCapError(path, after);
			}
			writeTextAtomic(path, result.content, { mode: FILE_MODE });
		} else tightenMode(path);
		const entries = parseNotes(result.content);
		return result.existing === undefined
			? { entries, changed: result.changed }
			: { entries, changed: result.changed, existing: result.existing };
	});
}
