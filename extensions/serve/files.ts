/**
 * Filesystem reads for the serve extension: classification, capped directory
 * listings, capped text reads, and the small sidebar tree. All paths are
 * absolute and already vetted by `paths.ts`; this module never touches the raw
 * request URL.
 */

import type { Dirent } from "node:fs";
import { readFile, readdir, stat, lstat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { HttpError } from "./paths.ts";

export type EntryKind = "directory" | "text" | "image" | "binary";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"]);
const TEXT_EXTS = new Set([
	".txt",
	".md",
	".markdown",
	".rst",
	".adoc",
	".org",
	".log",
	".json",
	".jsonc",
	".json5",
	".yaml",
	".yml",
	".toml",
	".ini",
	".cfg",
	".conf",
	".env",
	".xml",
	".csv",
	".tsv",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".go",
	".rs",
	".java",
	".c",
	".h",
	".cc",
	".cpp",
	".hpp",
	".cs",
	".rb",
	".php",
	".sh",
	".bash",
	".zsh",
	".ps1",
	".swift",
	".kt",
	".kts",
	".scala",
	".lua",
	".r",
	".pl",
	".sql",
	".css",
	".scss",
	".sass",
	".less",
	".html",
	".htm",
	".vue",
	".svelte",
	".astro",
	".gitignore",
	".gitattributes",
	".editorconfig",
]);
const TEXT_NAMES = new Set([
	"license",
	"licence",
	"makefile",
	"dockerfile",
	"readme",
	"changelog",
	"authors",
	"notice",
]);

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
	| (FileMeta & { kind: "image" })
	| (FileMeta & { kind: "binary" })
	| (FileMeta & { kind: "tooLarge" });

/** Whether the name has an image extension. */
export function isImageName(name: string): boolean {
	return IMAGE_EXTS.has(extname(name).toLowerCase());
}

/** Extension-based classification for listings (no file contents read). */
export function classifyByName(name: string): EntryKind {
	const ext = extname(name).toLowerCase();
	if (IMAGE_EXTS.has(ext)) return "image";
	if (TEXT_EXTS.has(ext)) return "text";
	const lower = basename(name).toLowerCase();
	if (TEXT_NAMES.has(lower)) return "text";
	if (!ext && name.startsWith(".")) return "text";
	return "binary";
}

/** True when the sample looks like binary data (NUL or many control bytes). */
export function isProbablyText(sample: Buffer): boolean {
	if (sample.length === 0) return true;
	if (sample.includes(0)) return false;
	let suspicious = 0;
	for (const byte of sample) {
		if (byte === 9 || byte === 10 || byte === 13 || byte === 12 || byte === 8) continue;
		if (byte < 32 || byte === 127) suspicious++;
	}
	return suspicious / sample.length < 0.3;
}

/** Compact byte size: `68 B`, `12.4 kB`, `1.5 MB`. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["kB", "MB", "GB", "TB"];
	let value = bytes;
	let index = -1;
	do {
		value /= 1024;
		index++;
	} while (value >= 1024 && index < units.length - 1);
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

/** MIME type for a name; text is always served as plain text. */
export function contentTypeFor(name: string): string {
	const ext = extname(name).toLowerCase();
	const map: Record<string, string> = {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
		".svg": "image/svg+xml",
		".bmp": "image/bmp",
		".ico": "image/x-icon",
		".avif": "image/avif",
	};
	return map[ext] ?? "application/octet-stream";
}

function toAbs(root: string, rel: string): string {
	return rel ? join(root, ...rel.split("/")) : root;
}

/** List a directory, sorted (directories first, then case-insensitive name). */
export async function listDirectory(root: string, relDir: string, limit: number): Promise<Listing> {
	const absDir = toAbs(root, relDir);
	let dirents: Dirent[];
	try {
		dirents = await readdir(absDir, { withFileTypes: true });
	} catch {
		throw new HttpError(404, "That folder could not be read.");
	}

	const entries: DirEntry[] = [];
	for (const dirent of dirents) {
		const abs = join(absDir, dirent.name);
		const isSymlink = dirent.isSymbolicLink();
		let isDir = dirent.isDirectory();
		let broken = false;
		let size = 0;
		let mtimeMs = 0;
		try {
			const info = isSymlink ? await lstat(abs) : await stat(abs);
			size = info.size;
			mtimeMs = info.mtimeMs;
		} catch {
			// Directory entry vanished between readdir and stat.
		}
		if (isSymlink) {
			try {
				const target = await stat(abs);
				isDir = target.isDirectory();
				size = target.size;
				mtimeMs = target.mtimeMs;
			} catch {
				broken = true;
			}
		}
		const kind: EntryKind = isDir ? "directory" : classifyByName(dirent.name);
		entries.push({
			name: dirent.name,
			rel: relDir ? `${relDir}/${dirent.name}` : dirent.name,
			isDir,
			isSymlink,
			broken,
			size,
			mtimeMs,
			kind,
			isImage: !isDir && kind === "image",
		});
	}

	entries.sort((a, b) => {
		if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});

	const total = entries.length;
	const truncated = total > limit;
	return { entries: truncated ? entries.slice(0, limit) : entries, total, truncated };
}

/** Read a file into a renderable view, honouring the size and line caps. */
export async function readFileView(
	root: string,
	rel: string,
	maxFileBytes: number,
	maxTextLines: number,
): Promise<FileView> {
	const abs = toAbs(root, rel);
	let info: Awaited<ReturnType<typeof stat>>;
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
	return {
		kind: "text",
		...meta,
		lines: truncated ? allLines.slice(0, maxTextLines) : allLines,
		truncated,
		totalLines: allLines.length,
	};
}

export interface TreeNode {
	name: string;
	rel: string;
	isDir: boolean;
	isImage: boolean;
	kind: EntryKind;
	children: TreeNode[];
}

/**
 * Build the sidebar tree: the current path's ancestors are expanded, siblings
 * are shown collapsed, and `depth` caps how far below the root it descends.
 */
export async function buildTree(root: string, currentRel: string, depth: number, limit: number): Promise<TreeNode> {
	return buildNode(root, "", currentRel, depth, basename(root) || root, limit);
}

async function buildNode(
	root: string,
	relDir: string,
	currentRel: string,
	depth: number,
	label: string,
	limit: number,
): Promise<TreeNode> {
	const node: TreeNode = { name: label, rel: relDir, isDir: true, isImage: false, kind: "directory", children: [] };
	if (depth < 0) return node;
	let listing: Listing;
	try {
		listing = await listDirectory(root, relDir, limit);
	} catch {
		return node;
	}
	for (const entry of listing.entries) {
		const child: TreeNode = {
			name: entry.name,
			rel: entry.rel,
			isDir: entry.isDir,
			isImage: entry.isImage,
			kind: entry.kind,
			children: [],
		};
		if (entry.isDir) {
			const onPath = currentRel === entry.rel || currentRel.startsWith(`${entry.rel}/`);
			if (onPath && depth > 0) {
				child.children = (await buildNode(root, entry.rel, currentRel, depth - 1, entry.name, limit)).children;
			}
		}
		node.children.push(child);
	}
	return node;
}
