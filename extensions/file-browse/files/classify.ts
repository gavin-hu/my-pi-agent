/**
 * What a file's kind is, from its name and — for an extensionless one — a byte sample.
 *
 * Every surface that names a kind (the listing's rows, the tree, a preview's routing) asks
 * here, so "is this an image" has one answer.
 */

import { basename, extname } from "node:path";

export type EntryKind = "directory" | "text" | "image" | "binary";

/** Image extension (no dot) to MIME type; the single source for image classification. */
const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	ico: "image/x-icon",
	avif: "image/avif",
};

/** Image extensions without a leading dot. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(IMAGE_MIME));

const MARKDOWN_EXTS = new Set([".md", ".markdown", ".mdown", ".mkd", ".mkdn"]);
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

export function isImageName(name: string): boolean {
	return IMAGE_EXTENSIONS.has(extname(name).slice(1).toLowerCase());
}

/** Whether the name has a Markdown extension. */
export function isMarkdownName(name: string): boolean {
	return MARKDOWN_EXTS.has(extname(name).toLowerCase());
}

/** Extension-based classification for listings (no file contents read). */
export function classifyByName(name: string): EntryKind {
	const ext = extname(name).toLowerCase();
	if (IMAGE_EXTENSIONS.has(ext.slice(1))) return "image";
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

/** MIME type for a name; text is always served as plain text. */
export function contentTypeFor(name: string): string {
	const ext = extname(name).slice(1).toLowerCase();
	return IMAGE_MIME[ext] ?? "application/octet-stream";
}
