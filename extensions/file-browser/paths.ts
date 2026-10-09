/**
 * Path safety for the serve extension.
 *
 * Every request path is untrusted: it is URL-decoded once, rejected when it is
 * malformed or absolute, resolved under the served root, and finally checked
 * with `realpath` so a symlink cannot escape the root. The resolved absolute
 * path is the only thing callers use; the raw URL is never passed to `fs`.
 */

import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isInside } from "../../lib/path.ts";

/** An HTTP-shaped failure the router turns into a status page. */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

/** Decode a URL path once, rejecting malformed percent escapes and NUL bytes. */
export function decodePath(raw: string): string {
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		throw new HttpError(400, "Malformed percent-encoding in the path.");
	}
	if (decoded.includes("\0")) throw new HttpError(400, "The path contains a NUL byte.");
	return decoded;
}

function isMissing(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Resolve the real location of a (possibly missing) path and require it to stay
 * inside the root. Missing tails are allowed so the caller can report 404.
 */
async function realpathContained(root: string, target: string): Promise<string> {
	let current = target;
	const tail: string[] = [];
	for (;;) {
		try {
			const real = realpathSync.native(current);
			const combined = tail.length > 0 ? resolve(real, ...tail) : real;
			if (!isInside(root, combined)) throw new HttpError(403, "That path is outside the served folder.");
			return combined;
		} catch (error) {
			if (error instanceof HttpError) throw error;
			if (!isMissing(error)) throw error;
			const parent = dirname(current);
			if (parent === current) throw new HttpError(404, "Not found.");
			tail.unshift(basename(current));
			current = parent;
		}
	}
}

/**
 * Resolve an already-decoded path to an absolute path under `root`. Use this
 * for values that came from `URLSearchParams`, which decodes once already.
 */
export async function resolveDecodedPath(root: string, decodedPath: string): Promise<string> {
	if (decodedPath.includes("\0")) throw new HttpError(400, "The path contains a NUL byte.");
	const rel = decodedPath.replace(/\\/g, "/").replace(/^\/+/, "");
	if (rel === "") return root;
	if (isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new HttpError(403, "Absolute paths are not served.");
	const candidate = resolve(root, rel);
	if (!isInside(root, candidate)) throw new HttpError(403, "That path is outside the served folder.");
	return realpathContained(root, candidate);
}

/**
 * Resolve a request path (relative to the root, leading slash optional) to an
 * absolute path under `root`. `root` should already be a real path.
 */
export async function resolveRequestPath(root: string, rawPath: string): Promise<string> {
	return resolveDecodedPath(root, decodePath(rawPath));
}

/** The root-relative, posix-style path of `abs` under `root` (`""` for root). */
export function relativePath(root: string, abs: string): string {
	const rel = relative(root, abs);
	return rel.split(sep).join("/");
}
