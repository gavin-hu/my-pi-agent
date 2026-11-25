/**
 * Path safety for the browse extension.
 *
 * Every request path is untrusted: it is URL-decoded once, rejected when it is
 * malformed or absolute, resolved under the served root, and finally checked
 * with `realpath` so a symlink cannot escape the root. The resolved absolute
 * path is the only thing callers use; the raw URL is never passed to `fs`.
 *
 * `browseTarget` is the same question asked by the command rather than by a page: the
 * argument `/browse` received wraps a folder to serve, or a file to open in the page its
 * folder would get.
 */

import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { encodePath, isInside, normalizeTarget, posixPath } from "../../../lib/path.ts";

// Re-exported where its callers already import it: one body, in `lib/path.ts`.
export { encodePath };

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
	return posixPath(relative(root, abs));
}

/** What a `/browse` argument names: a folder to serve, or a file to open in it. */
export interface BrowseTarget {
	root: string;
	/** The root-relative file the page should open, when the argument named one. */
	file?: string;
}

/**
 * The page root a `/browse` argument asks for, and the file it named.
 *
 * An empty argument — `/browse`, `/browse @`, a pair of quotes — is the working
 * directory. A folder is the page's root, as it always was. A file is shown in the page
 * its folder would get: the root stays the working directory, so the sidebar is the
 * project the file lives in and the file is what opens. Anything else, and anything
 * outside the working directory, is the one refusal — naming the target as it was
 * unwrapped, since `@src/app.ts` is what the person typed and not what was looked for.
 */
export async function browseTarget(base: string, raw: string): Promise<BrowseTarget> {
	const named = normalizeTarget(raw) || ".";
	const abs = await resolveRequestPath(base, named);
	const info = await stat(abs).catch(() => undefined);
	if (info?.isDirectory()) return { root: abs };
	if (info?.isFile()) return { root: base, file: relativePath(base, abs) };
	throw new HttpError(400, `${named} is not a file or folder inside the working directory`);
}
