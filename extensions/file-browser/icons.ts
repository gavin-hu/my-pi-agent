/**
 * Inline SVG icons and the per-language mapping used by the serve pages and the
 * `/api/tree` JSON. No external icon font or image is fetched; the sprite is
 * inlined once per page and referenced with `<use>`.
 */

import { extname } from "node:path";

export type IconName = "folder" | "file-code" | "file-text" | "file-image" | "file-json" | "file-archive" | "file";

export interface IconSpec {
	icon: IconName;
	/** CSS modifier class on the icon (`""`, `doc`, `img`, `cfg`, `arc`). */
	colorClass: string;
	/** Accessible language/category label, exposed via `title`. */
	label: string;
}

/** The hidden `<svg>` sprite injected into every page. */
export const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
<symbol id="i-folder" viewBox="0 0 16 16"><path fill="currentColor" d="M1.5 2.5h4l1.3 1.5h7.7v8.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z"/></symbol>
<symbol id="i-file" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 1.5h6l4 4V15H3zM9 1.5v4h4"/></symbol>
<symbol id="i-file-code" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 1.5h6l4 4V15H3zM9 1.5v4h4"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="M7 8.5 5 10.5l2 2m2-4 2 2-2 2"/></symbol>
<symbol id="i-file-text" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 1.5h6l4 4V15H3zM9 1.5v4h4M5.5 9h5M5.5 11.5h5"/></symbol>
<symbol id="i-file-image" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 1.5h6l4 4V15H3zM9 1.5v4h4"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="M4.5 13.5 7 10l2 2 1.5-2 1 1.5"/><circle cx="6" cy="7" r="1"/></symbol>
<symbol id="i-file-json" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 1.5h6l4 4V15H3zM9 1.5v4h4"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="M6.5 8.5c-1 .5-1 3 .5 3.5-1.5.5-1.5 3-.5 3.5M9.5 8.5c1 .5 1 3-.5 3.5 1.5.5 1.5 3 .5 3.5"/></symbol>
<symbol id="i-file-archive" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 1.5h6l4 4V15H3zM9 1.5v4h4"/><path fill="none" stroke="currentColor" stroke-width="1.1" d="M7 6v2M7 9v2M7 12v1.5"/></symbol>
</svg>`;

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const ARCHIVE = new Set(["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war"]);
const DOC = new Set(["md", "markdown", "txt", "rst", "adoc", "org", "log", "pdf", "doc", "docx"]);
const CONFIG = new Set(["json", "jsonc", "json5", "yaml", "yml", "toml", "ini", "cfg", "conf", "env", "lock"]);

const LANGUAGES: Record<string, { label: string; icon: IconName; colorClass: string }> = {
	ts: { label: "TypeScript", icon: "file-code", colorClass: "" },
	tsx: { label: "TypeScript", icon: "file-code", colorClass: "" },
	mts: { label: "TypeScript", icon: "file-code", colorClass: "" },
	cts: { label: "TypeScript", icon: "file-code", colorClass: "" },
	js: { label: "JavaScript", icon: "file-code", colorClass: "" },
	jsx: { label: "JavaScript", icon: "file-code", colorClass: "" },
	mjs: { label: "JavaScript", icon: "file-code", colorClass: "" },
	cjs: { label: "JavaScript", icon: "file-code", colorClass: "" },
	py: { label: "Python", icon: "file-code", colorClass: "" },
	go: { label: "Go", icon: "file-code", colorClass: "" },
	rs: { label: "Rust", icon: "file-code", colorClass: "" },
	java: { label: "Java", icon: "file-code", colorClass: "" },
	c: { label: "C", icon: "file-code", colorClass: "" },
	h: { label: "C header", icon: "file-code", colorClass: "" },
	cc: { label: "C++", icon: "file-code", colorClass: "" },
	cpp: { label: "C++", icon: "file-code", colorClass: "" },
	hpp: { label: "C++ header", icon: "file-code", colorClass: "" },
	cs: { label: "C#", icon: "file-code", colorClass: "" },
	rb: { label: "Ruby", icon: "file-code", colorClass: "" },
	php: { label: "PHP", icon: "file-code", colorClass: "" },
	sh: { label: "Shell", icon: "file-code", colorClass: "" },
	bash: { label: "Shell", icon: "file-code", colorClass: "" },
	zsh: { label: "Shell", icon: "file-code", colorClass: "" },
	ps1: { label: "PowerShell", icon: "file-code", colorClass: "" },
	swift: { label: "Swift", icon: "file-code", colorClass: "" },
	kt: { label: "Kotlin", icon: "file-code", colorClass: "" },
	kts: { label: "Kotlin", icon: "file-code", colorClass: "" },
	scala: { label: "Scala", icon: "file-code", colorClass: "" },
	lua: { label: "Lua", icon: "file-code", colorClass: "" },
	r: { label: "R", icon: "file-code", colorClass: "" },
	pl: { label: "Perl", icon: "file-code", colorClass: "" },
	sql: { label: "SQL", icon: "file-code", colorClass: "" },
	css: { label: "CSS", icon: "file-code", colorClass: "" },
	scss: { label: "SCSS", icon: "file-code", colorClass: "" },
	sass: { label: "Sass", icon: "file-code", colorClass: "" },
	less: { label: "Less", icon: "file-code", colorClass: "" },
	html: { label: "HTML", icon: "file-code", colorClass: "" },
	htm: { label: "HTML", icon: "file-code", colorClass: "" },
	xml: { label: "XML", icon: "file-code", colorClass: "" },
	vue: { label: "Vue", icon: "file-code", colorClass: "" },
	svelte: { label: "Svelte", icon: "file-code", colorClass: "" },
	astro: { label: "Astro", icon: "file-code", colorClass: "" },
	md: { label: "Markdown", icon: "file-text", colorClass: "doc" },
	markdown: { label: "Markdown", icon: "file-text", colorClass: "doc" },
	rst: { label: "reStructuredText", icon: "file-text", colorClass: "doc" },
	adoc: { label: "AsciiDoc", icon: "file-text", colorClass: "doc" },
	txt: { label: "Text", icon: "file-text", colorClass: "doc" },
	log: { label: "Log", icon: "file-text", colorClass: "doc" },
	csv: { label: "CSV", icon: "file-text", colorClass: "doc" },
	tsv: { label: "TSV", icon: "file-text", colorClass: "doc" },
	json: { label: "JSON", icon: "file-json", colorClass: "cfg" },
	jsonc: { label: "JSON", icon: "file-json", colorClass: "cfg" },
	json5: { label: "JSON", icon: "file-json", colorClass: "cfg" },
	yaml: { label: "YAML", icon: "file-json", colorClass: "cfg" },
	yml: { label: "YAML", icon: "file-json", colorClass: "cfg" },
	toml: { label: "TOML", icon: "file-json", colorClass: "cfg" },
	ini: { label: "INI", icon: "file-json", colorClass: "cfg" },
	cfg: { label: "Config", icon: "file-json", colorClass: "cfg" },
	conf: { label: "Config", icon: "file-json", colorClass: "cfg" },
	env: { label: "Environment", icon: "file-json", colorClass: "cfg" },
	lock: { label: "Lockfile", icon: "file-json", colorClass: "cfg" },
};

/** The icon spec for a filename, falling back to a generic file. */
export function languageOf(name: string): IconSpec {
	const base = name.slice(name.lastIndexOf("/") + 1);
	const ext = extname(base).replace(/^\./, "").toLowerCase();
	const known = LANGUAGES[ext];
	if (known) return known;
	if (IMAGE.has(ext)) return { icon: "file-image", colorClass: "img", label: "Image" };
	if (ARCHIVE.has(ext)) return { icon: "file-archive", colorClass: "arc", label: "Archive" };
	if (DOC.has(ext)) return { icon: "file-text", colorClass: "doc", label: "Document" };
	if (CONFIG.has(ext)) return { icon: "file-json", colorClass: "cfg", label: "Config" };
	if (!ext && base.startsWith(".")) return { icon: "file-json", colorClass: "cfg", label: "Config" };
	return { icon: "file", colorClass: "", label: "File" };
}

/** The icon spec for the folder category. */
export const FOLDER_ICON: IconSpec = { icon: "folder", colorClass: "", label: "Folder" };

/** The `<use href>` target for an icon name. */
export function iconHref(icon: IconName): string {
	return `#i-${icon}`;
}
