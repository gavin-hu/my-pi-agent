/**
 * Directory listings and single-file reads: what a folder holds, capped and sorted, and
 * what one file's bytes are.
 *
 * The filesystem reads are injected (`DirectoryFs`) so a test can count them: the property
 * worth holding is that a directory is read once per entry, not once per row drawn.
 */

import { join } from "node:path";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { mapConcurrent } from "../../../lib/pool.ts";
import { HttpError } from "./paths.ts";
import {
	classifyByName,
	contentTypeFor,
	type EntryKind,
	isImageName,
	isMarkdownName,
	isProbablyText,
} from "./classify.ts";

export interface DirEntry {
	name: string;
	/** Root-relative posix path. */
	rel: string;
	isDir: boolean;
	isSymlink: boolean;
	broken: boolean;
	size: number;
	mtimeMs: number;
	kind: EntryKind;
	isImage: boolean;
}

export interface Listing {
	entries: DirEntry[];
	total: number;
	truncated: boolean;
}

export interface FileMeta {
	size: number;
	mtimeMs: number;
	mime: string;
}

export type FileView =
	| (FileMeta & { kind: "text"; lines: string[]; truncated: boolean; totalLines: number })
	| (FileMeta & { kind: "markdown"; lines: string[]; truncated: boolean; totalLines: number })
	| (FileMeta & { kind: "image" })
	| (FileMeta & { kind: "binary" })
	| (FileMeta & { kind: "tooLarge" });

/** Whether the name has an image extension. */
export function toAbs(root: string, rel: string): string {
	return rel ? join(root, ...rel.split("/")) : root;
}

/** The `Dirent` fields a listing reads; a test's fake need not be a real `Dirent`. */
export interface DirectoryEntryInfo {
	name: string;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

/** The `Stats` fields a listing reads. */
export interface DirectoryStats {
	size: number;
	mtimeMs: number;
	isDirectory(): boolean;
}

/**
 * The three filesystem reads a listing makes.
 *
 * Injected so a test can observe them: the interesting property — a directory is
 * read once per entry, not once per entry *and* once per row drawn — is a count,
 * not a value, and a wall-clock assertion would be flaky on a loaded machine.
 */
export interface DirectoryFs {
	readdir(path: string): Promise<DirectoryEntryInfo[]>;
	lstat(path: string): Promise<DirectoryStats>;
	stat(path: string): Promise<DirectoryStats>;
}

/** Production reads; a symlink's size and kind come from the target. */
const NODE_DIRECTORY_FS: DirectoryFs = {
	readdir: (path) => readdir(path, { withFileTypes: true }),
	lstat: (path) => lstat(path),
	stat: (path) => stat(path),
};

/** Reads in flight per listing: enough to hide latency, bounded against a burst. */
const LISTING_CONCURRENCY = 32;

/** A row while it is still missing its metadata. */
interface Row {
	name: string;
	rel: string;
	isDir: boolean;
	isSymlink: boolean;
	broken: boolean;
	size: number;
	mtimeMs: number;
}

/**
 * Resolve one symlink: the link's own stat, then the target's.
 *
 * A symlink's directory-ness is the target's, so this cannot wait until after
 * the sort; it is also the only entry whose classification needs a read.
 */
async function resolveSymlink(fs: DirectoryFs, absDir: string, row: Row): Promise<void> {
	const abs = join(absDir, row.name);
	try {
		const info = await fs.lstat(abs);
		row.size = info.size;
		row.mtimeMs = info.mtimeMs;
	} catch {
		// Vanished between readdir and lstat: the target read decides below.
	}
	try {
		const target = await fs.stat(abs);
		row.isDir = target.isDirectory();
		row.size = target.size;
		row.mtimeMs = target.mtimeMs;
	} catch {
		row.broken = true;
	}
}

/**
 * List a directory, sorted (directories first, then case-insensitive name).
 *
 * A listing is latency per entry, not work per entry, so it is read in three
 * passes instead of one entry at a time:
 *
 * 1. `readdir`, whose dirents already say whether each name is a directory;
 * 2. the symlinks only, resolved through the pool, because their kind is the
 *    target's and the sort needs it;
 * 3. the kept rows only, `stat`ed through the pool — so a directory of three
 *    thousand names pays for the two thousand it draws, not for every name, and
 *    pays them concurrently instead of in turn.
 *
 * `total` is still the directory's full entry count and `truncated` its `> limit`
 * flip, so the page can say how many were dropped. Ties keep `readdir` order:
 * `sort` is stable and the rows arrive unsorted.
 */
export async function listDirectory(
	root: string,
	relDir: string,
	limit: number,
	fs: DirectoryFs = NODE_DIRECTORY_FS,
): Promise<Listing> {
	const absDir = toAbs(root, relDir);
	let dirents: DirectoryEntryInfo[];
	try {
		dirents = await fs.readdir(absDir);
	} catch {
		throw new HttpError(404, "That folder could not be read.");
	}

	const links: Row[] = [];
	const rows: Row[] = dirents.map((dirent) => {
		const row: Row = {
			name: dirent.name,
			rel: relDir ? `${relDir}/${dirent.name}` : dirent.name,
			isDir: dirent.isDirectory(),
			isSymlink: dirent.isSymbolicLink(),
			broken: false,
			size: 0,
			mtimeMs: 0,
		};
		if (row.isSymlink) links.push(row);
		return row;
	});

	await mapConcurrent(links, LISTING_CONCURRENCY, (row) => resolveSymlink(fs, absDir, row));

	// Directories first, then case-insensitive name. The sort runs before the cap,
	// so the rows that survive it are the rows that would have been drawn.
	rows.sort((a, b) => {
		if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});

	const total = rows.length;
	const truncated = total > limit;
	const kept = truncated ? rows.slice(0, limit) : rows;

	await mapConcurrent(
		kept.filter((row) => !row.isSymlink),
		LISTING_CONCURRENCY,
		async (row) => {
			try {
				const info = await fs.stat(join(absDir, row.name));
				row.size = info.size;
				row.mtimeMs = info.mtimeMs;
			} catch {
				// Directory entry vanished between readdir and stat.
			}
		},
	);

	const entries: DirEntry[] = kept.map((row) => {
		const kind: EntryKind = row.isDir ? "directory" : classifyByName(row.name);
		return {
			name: row.name,
			rel: row.rel,
			isDir: row.isDir,
			isSymlink: row.isSymlink,
			broken: row.broken,
			size: row.size,
			mtimeMs: row.mtimeMs,
			kind,
			isImage: !row.isDir && kind === "image",
		};
	});

	return { entries, total, truncated };
}

/** Read a file into a renderable view, honouring the size and line caps. */
export async function readFileView(
	root: string,
	rel: string,
	maxFileBytes: number,
	maxTextLines: number,
	markdownEnabled = true,
): Promise<FileView> {
	const abs = toAbs(root, rel);
	let info: Stats;
	try {
		info = await stat(abs);
	} catch {
		throw new HttpError(404, "That file could not be read.");
	}
	if (info.isDirectory()) throw new HttpError(404, "That path is a folder.");

	const meta: FileMeta = { size: info.size, mtimeMs: info.mtimeMs, mime: contentTypeFor(rel) };
	if (isImageName(rel)) return { kind: "image", ...meta };
	if (info.size > maxFileBytes) return { kind: "tooLarge", ...meta };

	let buffer: Buffer;
	try {
		buffer = await readFile(abs);
	} catch {
		throw new HttpError(404, "That file could not be read.");
	}
	if (!isProbablyText(buffer)) return { kind: "binary", ...meta };

	const allLines = buffer.toString("utf-8").split(/\r\n|\r|\n/);
	const truncated = allLines.length > maxTextLines;
	const lines = truncated ? allLines.slice(0, maxTextLines) : allLines;
	const kind = markdownEnabled && isMarkdownName(rel) ? "markdown" : "text";
	if (kind === "markdown") {
		return { kind: "markdown", ...meta, lines, truncated, totalLines: allLines.length };
	}
	return { kind: "text", ...meta, lines, truncated, totalLines: allLines.length };
}
