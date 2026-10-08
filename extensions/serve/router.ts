/**
 * The request router for the serve extension.
 *
 * A request is matched to a route, every path goes through `paths.ts`, and the
 * filesystem reads are capped by config. The function returns a plain
 * `ServeResponse` (or a file descriptor the server streams), so it can be
 * tested without a socket.
 */

import { stat } from "node:fs/promises";
import { CLIENT_JS } from "./client.ts";
import type { ServeConfig } from "./config.ts";
import {
	buildTree,
	contentTypeFor,
	isImageName,
	listDirectory,
	readFileView,
	type DirEntry,
	type TreeNode,
} from "./files.ts";
import { FOLDER_ICON, iconHref, languageOf } from "./icons.ts";
import { encodePath, renderDirectoryPage, renderErrorPage, renderFilePage } from "./html.ts";
import { HttpError, relativePath, resolveDecodedPath, resolveRequestPath } from "./paths.ts";

export interface ServeContext {
	root: string;
	config: ServeConfig;
}

export interface ServeResponse {
	status: number;
	headers: Record<string, string>;
	body?: string | Buffer;
	/** When set, the server streams this file instead of `body`. */
	filePath?: string;
}

const HOST_PATTERN = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

const HTML_SECURITY: Record<string, string> = {
	"Content-Type": "text/html; charset=utf-8",
	"Content-Security-Policy":
		"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
};

const RAW_SECURITY: Record<string, string> = {
	"Content-Security-Policy": "default-src 'none'; script-src 'none'; sandbox",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "no-referrer",
	"Cache-Control": "no-store",
};

function htmlResponse(status: number, body: string): ServeResponse {
	return { status, headers: { ...HTML_SECURITY }, body };
}

function jsonResponse(status: number, value: unknown): ServeResponse {
	return {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "no-referrer",
			"Cache-Control": "no-store",
		},
		body: JSON.stringify(value),
	};
}

async function treeFor(ctx: ServeContext, _currentRel: string): Promise<TreeNode> {
	return buildTree(ctx.root, _currentRel, ctx.config.treeDepth, ctx.config.maxDirEntries);
}

async function errorResponse(
	ctx: ServeContext,
	status: number,
	message: string,
	extra?: Record<string, string>,
): Promise<ServeResponse> {
	let tree: TreeNode = { name: ctx.root, rel: "", isDir: true, isImage: false, kind: "directory", children: [] };
	try {
		tree = await treeFor(ctx, "");
	} catch {
		// Keep the minimal tree.
	}
	const body = renderErrorPage({ rootLabel: ctx.root, status, message, tree, rel: "" });
	return { status, headers: { ...HTML_SECURITY, ...extra }, body };
}

async function browse(ctx: ServeContext, rawRel: string): Promise<ServeResponse> {
	const abs = await resolveRequestPath(ctx.root, rawRel);
	const rel = relativePath(ctx.root, abs);
	const info = await stat(abs).catch(() => undefined);
	if (!info || !info.isDirectory()) return view(ctx, rawRel);

	const listing = await listDirectory(ctx.root, rel, ctx.config.maxDirEntries);
	const tree = await treeFor(ctx, rel);
	return htmlResponse(
		200,
		renderDirectoryPage({
			rootLabel: ctx.root,
			rel,
			listing,
			tree,
			thumbnails: ctx.config.thumbnails,
			maxThumbBytes: ctx.config.maxThumbBytes,
		}),
	);
}

async function view(ctx: ServeContext, rawRel: string): Promise<ServeResponse> {
	const abs = await resolveRequestPath(ctx.root, rawRel);
	const rel = relativePath(ctx.root, abs);
	const info = await stat(abs).catch(() => undefined);
	if (info?.isDirectory()) return browse(ctx, rawRel);
	if (!info) throw new HttpError(404, "That path does not exist.");

	const file = await readFileView(ctx.root, rel, ctx.config.maxFileBytes, ctx.config.maxTextLines);
	const tree = await treeFor(ctx, rel);
	return htmlResponse(
		200,
		renderFilePage({ rootLabel: ctx.root, rel, file, tree, maxFileBytes: ctx.config.maxFileBytes }),
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

function treeApiEntry(entry: DirEntry): Record<string, unknown> {
	const spec = entry.isDir ? FOLDER_ICON : languageOf(entry.name);
	return {
		name: entry.name,
		path: entry.rel,
		href: entry.isDir ? `/browse/${encodePath(entry.rel)}` : `/view/${encodePath(entry.rel)}`,
		isDir: entry.isDir,
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
	return jsonResponse(200, { path: rel, entries: listing.entries.map(treeApiEntry) });
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
		return errorResponse(ctx, 405, "Only GET and HEAD are served.", { Allow: "GET, HEAD" });
	}
	const host = headers.host;
	if (typeof host === "string" && host && !HOST_PATTERN.test(host)) {
		return errorResponse(ctx, 403, "Unexpected Host header.");
	}

	let pathname: string;
	let search: URLSearchParams;
	try {
		const url = new URL(rawUrl, "http://127.0.0.1");
		pathname = url.pathname;
		search = url.searchParams;
	} catch {
		return errorResponse(ctx, 400, "Malformed request URL.");
	}

	try {
		if (pathname === "/app.js") {
			return {
				status: 200,
				headers: { ...HTML_SECURITY, "Content-Type": "text/javascript; charset=utf-8" },
				body: CLIENT_JS,
			};
		}
		if (pathname === "/favicon.ico") return { status: 204, headers: { ...HTML_SECURITY }, body: "" };
		if (pathname === "/api/tree") return await treeApi(ctx, search.get("path") ?? "");
		if (pathname === "/" || pathname === "/browse" || pathname === "/browse/") return await browse(ctx, "");
		if (pathname.startsWith("/browse/")) return await browse(ctx, pathname.slice("/browse/".length));
		if (pathname.startsWith("/view/")) return await view(ctx, pathname.slice("/view/".length));
		if (pathname.startsWith("/raw/")) return await raw(ctx, pathname.slice("/raw/".length));
		return errorResponse(ctx, 404, "That page does not exist.");
	} catch (error) {
		if (error instanceof HttpError) return errorResponse(ctx, error.status, error.message);
		return errorResponse(ctx, 500, "Something went wrong reading that path.");
	}
}
