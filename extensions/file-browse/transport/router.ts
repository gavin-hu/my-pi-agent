/**
 * The request router for the browse extension.
 *
 * A request is matched to a route, every path goes through `paths.ts`, and the
 * filesystem reads are capped by config. The function returns a plain
 * `ServeResponse` (or a file descriptor the server streams), so it can be
 * tested without a socket.
 */

import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import {
	eventHeaders,
	htmlResponse,
	isLocalHostHeader,
	jsonError,
	jsonResponse,
	parseRequestUrl,
	scriptHeaders,
	type ServeResponse,
} from "../../../lib/http/index.ts";
import { THEME_JS, THEME_JS_PATH } from "../../../lib/web/index.ts";
import { CLIENT_JS } from "../view/client.ts";
import type { LivePage } from "../view/chrome.ts";
import type { ServeConfig } from "../config/config.ts";
import { isDiffMode, type DiffMode } from "../text/diff.ts";
import type { DiffList, GitDiffProvider, GitStatus, GitStatusProvider } from "../git/git.ts";
import { changeIndexOf, type LiveStatusSource } from "../live/live.ts";
import {
	buildFileIndex,
	buildTree,
	contentTypeFor,
	directoryView,
	isImageName,
	listDirectory,
	readFileView,
	type DirEntry,
	type FileIndexProvider,
	type TreeNode,
} from "../files/files.ts";
import { FOLDER_ICON, iconHref, languageOf } from "../view/icons.ts";
import { fuzzySearch } from "../text/fuzzy.ts";
import {
	renderDirectoryPage,
	renderDiffPage,
	renderErrorPage,
	renderFileDiffPage,
	renderFilePage,
	hrefFor,
} from "../view/html.ts";
import type { ChangeSummary } from "../view/html.ts";
import { HttpError, relativePath, resolveDecodedPath, resolveRequestPath } from "../files/paths.ts";
import { listingRevision } from "../live/rev.ts";

export interface ServeContext {
	root: string;
	/** The prefix this page answers under, e.g. `/files`; `""` for the origin's root. */
	base: string;
	config: ServeConfig;
	/** Read-only git context for the page header; omitted when unavailable. */
	git?: GitStatusProvider;
	/** Read-only diff provider; omitted when the diff view is unavailable. */
	diff?: GitDiffProvider;
	/** Cached quick-open file index; built on demand when omitted. */
	index?: FileIndexProvider;
	/** Snapshot source for the live status channel; omitted when live status is off. */
	live?: LiveStatusSource;
}

/** Most palette rows the client will render for one query. */
const RESULT_LIMIT = 50;

/**
 * A downloaded or inlined file: no script, no network, and sandboxed, so a served
 * SVG or HTML file cannot execute. Only `/raw` uses it, because it is the only
 * route whose body is someone else's file rather than a page this extension built.
 */
const RAW_SECURITY: Record<string, string> = {
	"Content-Security-Policy": "default-src 'none'; script-src 'none'; sandbox",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
};

async function treeFor(ctx: ServeContext, currentRel: string): Promise<TreeNode> {
	return buildTree(ctx.root, currentRel, ctx.config.maxDirEntries);
}

/** Resolve the header's git context, never failing the request. */
async function gitFor(ctx: ServeContext): Promise<GitStatus | undefined> {
	if (!ctx.git) return undefined;
	try {
		return await ctx.git();
	} catch {
		return undefined;
	}
}

/** The change list for a mode, or `undefined` outside a repository. */
async function diffFor(ctx: ServeContext, mode: DiffMode) {
	if (!ctx.config.gitDiff || !ctx.diff) return undefined;
	try {
		return await ctx.diff.list(mode);
	} catch {
		return undefined;
	}
}

/** The marker/totals index derived from a change list. */
function summaryOf(list: DiffList): ChangeSummary {
	const index = changeIndexOf(list);
	return {
		count: index.count,
		insertions: index.insertions,
		deletions: index.deletions,
		files: index.files,
		dirs: index.dirs,
	};
}

/**
 * The live chrome a page renders, or `undefined` when live status is off. A
 * listing page also passes the revision of what it drew, which is what its
 * reload control compares against; every other page has nothing to compare.
 */
function liveOf(ctx: ServeContext, folder?: { dir: string; rev: string }): LivePage | undefined {
	return ctx.config.live && ctx.live ? { intervalMs: ctx.config.liveIntervalMs, ...folder } : undefined;
}

/** The `head` change summary, for the header chip, tree markers, and file action. */
async function changed(ctx: ServeContext): Promise<ChangeSummary | undefined> {
	const list = await diffFor(ctx, "head");
	return list ? summaryOf(list) : undefined;
}

/** The error page: the browse shell with the status, the reason, and a usable tree. */
async function errorPage(
	ctx: ServeContext,
	status: number,
	message: string,
	extra?: Record<string, string>,
): Promise<ServeResponse> {
	let tree: TreeNode = {
		name: ctx.root,
		rel: "",
		isDir: true,
		isImage: false,
		broken: false,
		kind: "directory",
		children: [],
	};
	try {
		tree = await treeFor(ctx, "");
	} catch {
		// Keep the minimal tree.
	}
	const body = renderErrorPage({
		base: ctx.base,
		rootLabel: ctx.root,
		status,
		message,
		tree,
		git: await gitFor(ctx),
		live: liveOf(ctx),
	});
	return htmlResponse(status, body, extra);
}

/** Resolve a request path once and render the directory or file page it names. */
async function renderPath(ctx: ServeContext, rawRel: string, raw: boolean): Promise<ServeResponse> {
	const abs = await resolveRequestPath(ctx.root, rawRel);
	const rel = relativePath(ctx.root, abs);
	const info: Stats | undefined = await stat(abs).catch(() => undefined);
	if (info?.isDirectory()) return directoryResponse(ctx, rel);
	if (!info) throw new HttpError(404, "That path does not exist.");
	return fileResponse(ctx, rel, raw);
}

async function browse(ctx: ServeContext, rawRel: string): Promise<ServeResponse> {
	return renderPath(ctx, rawRel, false);
}

async function view(ctx: ServeContext, rawRel: string, raw: boolean): Promise<ServeResponse> {
	return renderPath(ctx, rawRel, raw);
}

async function directoryResponse(ctx: ServeContext, rel: string): Promise<ServeResponse> {
	const { listing, tree } = await directoryView(ctx.root, rel, ctx.config.maxDirEntries);
	const git = await gitFor(ctx);
	const changes = await changed(ctx);
	return htmlResponse(
		200,
		renderDirectoryPage({
			base: ctx.base,
			rootLabel: ctx.root,
			rel,
			listing,
			tree,
			thumbnails: ctx.config.thumbnails,
			maxThumbBytes: ctx.config.maxThumbBytes,
			git,
			summary: changes,
			live: liveOf(
				ctx,
				listing.truncated ? undefined : { dir: rel, rev: listingRevision(listing.entries.map((entry) => entry.name)) },
			),
		}),
	);
}

async function fileResponse(ctx: ServeContext, rel: string, raw: boolean): Promise<ServeResponse> {
	const file = await readFileView(ctx.root, rel, ctx.config.maxFileBytes, ctx.config.maxTextLines, ctx.config.markdown);
	const tree = await treeFor(ctx, rel);
	const git = await gitFor(ctx);
	const changes = await changed(ctx);
	return htmlResponse(
		200,
		renderFilePage({
			base: ctx.base,
			rootLabel: ctx.root,
			rel,
			file,
			tree,
			maxFileBytes: ctx.config.maxFileBytes,
			git,
			markdownRaw: raw,
			markdownHtml: ctx.config.markdownHtml,
			changed: changes?.files.has(rel),
			summary: changes,
			live: liveOf(ctx),
		}),
	);
}

/** The change overview page for a mode. A non-repository is an empty state, not an error. */
async function diffOverview(ctx: ServeContext, mode: DiffMode): Promise<ServeResponse> {
	if (!ctx.config.gitDiff || !ctx.diff) throw new HttpError(404, "The diff view is not available.");
	const list = await diffFor(ctx, mode);
	const tree = await treeFor(ctx, "");
	const git = await gitFor(ctx);
	return htmlResponse(
		200,
		renderDiffPage({
			base: ctx.base,
			rootLabel: ctx.root,
			mode,
			files: list?.files ?? [],
			stat: list?.stat ?? "",
			tree,
			git,
			summary: list ? summaryOf(list) : undefined,
			live: liveOf(ctx),
		}),
	);
}

/** A single file's unified diff for a mode. */
async function diffFile(ctx: ServeContext, rawRel: string, mode: DiffMode): Promise<ServeResponse> {
	if (!ctx.config.gitDiff || !ctx.diff) throw new HttpError(404, "The diff view is not available.");
	const abs = await resolveRequestPath(ctx.root, rawRel);
	const rel = relativePath(ctx.root, abs);
	const info = await stat(abs).catch(() => undefined);
	if (info?.isDirectory()) throw new HttpError(400, "That path is a folder.");
	let diff: Awaited<ReturnType<GitDiffProvider["file"]>>;
	try {
		diff = await ctx.diff.file(rel, mode);
	} catch {
		diff = undefined;
	}
	if (!diff) throw new HttpError(404, "No diff is available for that file.");
	const tree = await treeFor(ctx, rel);
	const git = await gitFor(ctx);
	const changes = await changed(ctx);
	return htmlResponse(
		200,
		renderFileDiffPage({
			base: ctx.base,
			rootLabel: ctx.root,
			rel,
			mode,
			diff,
			tree,
			git,
			summary: changes,
			live: liveOf(ctx),
		}),
	);
}

function disposition(rel: string, inline: boolean): string {
	const name = rel.slice(rel.lastIndexOf("/") + 1).replace(/["\\\r\n]/g, "_");
	const encoded = encodeURIComponent(rel.slice(rel.lastIndexOf("/") + 1));
	return `${inline ? "inline" : "attachment"}; filename="${name}"; filename*=UTF-8''${encoded}`;
}

async function raw(ctx: ServeContext, rawRel: string): Promise<ServeResponse> {
	const abs = await resolveRequestPath(ctx.root, rawRel);
	const rel = relativePath(ctx.root, abs);
	const info = await stat(abs).catch(() => undefined);
	if (!info || info.isDirectory()) throw new HttpError(404, "That file does not exist.");
	const inline = isImageName(rel) && !/\.svg$/i.test(rel);
	return {
		status: 200,
		headers: {
			...RAW_SECURITY,
			"Content-Type": contentTypeFor(rel),
			"Content-Length": String(info.size),
			"Content-Disposition": disposition(rel, inline),
		},
		filePath: abs,
	};
}

function treeApiEntry(entry: DirEntry, base: string): Record<string, unknown> {
	const spec = entry.isDir ? FOLDER_ICON : languageOf(entry.name);
	return {
		name: entry.name,
		path: entry.rel,
		href: hrefFor(entry, base),
		isDir: entry.isDir,
		broken: entry.broken,
		iconHref: iconHref(spec.icon),
		colorClass: spec.colorClass,
		label: spec.label,
	};
}

async function treeApi(ctx: ServeContext, decodedPath: string): Promise<ServeResponse> {
	const abs = await resolveDecodedPath(ctx.root, decodedPath);
	const rel = relativePath(ctx.root, abs);
	const info = await stat(abs).catch(() => undefined);
	if (info && !info.isDirectory()) throw new HttpError(400, "That path is not a folder.");
	const listing = await listDirectory(ctx.root, rel, ctx.config.maxDirEntries);
	return jsonResponse(200, { path: rel, entries: listing.entries.map((entry) => treeApiEntry(entry, ctx.base)) });
}

/** The revision of one folder's listing: what a page's reload control compares against. */
async function dirRevApi(ctx: ServeContext, decodedPath: string): Promise<ServeResponse> {
	const abs = await resolveDecodedPath(ctx.root, decodedPath);
	const rel = relativePath(ctx.root, abs);
	const listing = await listDirectory(ctx.root, rel, ctx.config.maxDirEntries);
	// A truncated listing is a prefix whose boundary moves, so its revision is not
	// comparable with what the page drew: `null` says "cannot tell".
	const names = listing.entries.map((entry) => entry.name);
	return jsonResponse(200, { path: rel, rev: listing.truncated ? null : listingRevision(names) });
}

/** Fuzzy file search for the quick-open palette, over the cached index. */
async function filesApi(ctx: ServeContext, query: string): Promise<ServeResponse> {
	const index = ctx.index ? await ctx.index() : await buildFileIndex(ctx.root, ctx.config.maxIndexEntries);
	const results = fuzzySearch(query, index.files, RESULT_LIMIT);
	return jsonResponse(200, { query, total: index.files.length, truncated: index.truncated, results });
}

/**
 * The live status stream: a marker response the server in `server.ts` keeps open
 * and feeds from the same source.
 */
function liveEvents(ctx: ServeContext): ServeResponse {
	if (!ctx.config.live || !ctx.live) throw new HttpError(404, "Live status is not available.");
	return { status: 200, headers: eventHeaders(), stream: true };
}

/**
 * Handle one request. `method` and `headers` are the raw HTTP values; `rawUrl`
 * is the request target (path plus optional query).
 */
export async function handleRequest(
	ctx: ServeContext,
	method: string,
	rawUrl: string,
	headers: Record<string, string | string[] | undefined> = {},
): Promise<ServeResponse> {
	const upper = method.toUpperCase();
	if (upper !== "GET" && upper !== "HEAD") {
		return errorPage(ctx, 405, "Only GET and HEAD are served.", { Allow: "GET, HEAD" });
	}
	if (!isLocalHostHeader(headers, { required: false })) {
		return errorPage(ctx, 403, "Unexpected Host header.");
	}

	const parsed = parseRequestUrl(rawUrl);
	if (!parsed) return errorPage(ctx, 400, "Malformed request URL.");
	const { pathname, search } = parsed;

	try {
		if (pathname === "/app.js") return { status: 200, headers: scriptHeaders(), body: CLIENT_JS };
		if (pathname === THEME_JS_PATH) return { status: 200, headers: scriptHeaders(), body: THEME_JS };
		if (pathname === "/api/tree") return await treeApi(ctx, search.get("path") ?? "");
		if (pathname === "/api/dir-rev") return await dirRevApi(ctx, search.get("path") ?? "");
		if (pathname === "/api/files") return await filesApi(ctx, search.get("q") ?? "");
		if (pathname === "/events") return liveEvents(ctx);
		const rawMode = search.get("mode");
		if (rawMode !== null && !isDiffMode(rawMode)) return errorPage(ctx, 400, "Unknown diff mode.");
		const mode: DiffMode = isDiffMode(rawMode) ? rawMode : "head";
		if (pathname === "/diff" || pathname === "/diff/") return await diffOverview(ctx, mode);
		if (pathname.startsWith("/diff/")) return await diffFile(ctx, pathname.slice("/diff/".length), mode);
		if (pathname === "/" || pathname === "/browse" || pathname === "/browse/") return await browse(ctx, "");
		if (pathname.startsWith("/browse/")) return await browse(ctx, pathname.slice("/browse/".length));
		if (pathname.startsWith("/view/"))
			return await view(ctx, pathname.slice("/view/".length), search.get("raw") === "1");
		if (pathname.startsWith("/raw/")) return await raw(ctx, pathname.slice("/raw/".length));
		return errorPage(ctx, 404, "That page does not exist.");
	} catch (error) {
		const status = error instanceof HttpError ? error.status : 500;
		const message = error instanceof HttpError ? error.message : "Something went wrong reading that path.";
		if (pathname.startsWith("/api/")) return jsonError(status, message);
		return errorPage(ctx, status, message);
	}
}
