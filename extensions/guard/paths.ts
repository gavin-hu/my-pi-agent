/**
 * Protected-path matching for the guard extension (pure).
 *
 * Patterns use gitignore syntax and are matched against the path relative to
 * the session's working directory, converted to posix separators. The last
 * matching pattern wins, so `!` re-allows a path an earlier pattern protected.
 *
 * This is a guard rail, not a sandbox: it stops accidental writes to sensitive
 * files, not a hostile command.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GuardConfig } from "./config.ts";

function escapeRegExp(char: string): string {
	return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Translate one gitignore-style pattern into a regular expression over a posix path. */
export function globToRegExp(pattern: string): RegExp {
	let body = pattern;
	let dirOnly = false;
	if (body.endsWith("/")) {
		dirOnly = true;
		body = body.slice(0, -1);
	}
	if (body.startsWith("/")) body = body.slice(1);
	const anchored = body.includes("/");

	let re = "";
	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (char === "\\" && i + 1 < body.length) {
			i++;
			re += escapeRegExp(body[i]);
		} else if (char === "*") {
			if (body[i + 1] === "*") {
				i++;
				if (body[i + 1] === "/") {
					i++;
					re += "(?:.*/)?";
				} else {
					re += ".*";
				}
			} else {
				re += "[^/]*";
			}
		} else if (char === "?") {
			re += "[^/]";
		} else if (char === "[") {
			const end = body.indexOf("]", i + 1);
			if (end === -1) {
				re += "\\[";
				continue;
			}
			let set = body.slice(i + 1, end);
			i = end;
			let negate = false;
			if (set.startsWith("!") || set.startsWith("^")) {
				negate = true;
				set = set.slice(1);
			}
			re += `[${negate ? "^" : ""}${set.replace(/[\\\]^]/g, "\\$&")}]`;
		} else {
			re += escapeRegExp(char);
		}
	}

	const prefix = anchored ? "" : "(?:.*/)?";
	const suffix = dirOnly ? "(?:/.*)?" : "";
	return new RegExp(`^${prefix}${re}${suffix}$`);
}

/** Absolute path for a tool's `path` argument, resolved against the working directory. */
export function resolveInput(cwd: string, path: string): string {
	return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

/** The posix path a pattern is matched against: relative to `cwd` when possible, else absolute. */
export function toMatchPath(absPath: string, cwd: string): string {
	const rel = relative(cwd, absPath);
	if (rel === "") return ".";
	if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		return absPath.split(sep).join("/");
	}
	return rel.split(sep).join("/");
}

export interface PathMatch {
	protected: boolean;
	/** The pattern responsible, when `protected` is true. */
	pattern?: string;
}

/** Last match wins; `!` negates. */
export function matchProtectedPath(matchPath: string, patterns: string[]): PathMatch {
	let matched = false;
	let pattern: string | undefined;
	for (const raw of patterns) {
		let current = raw;
		let negate = false;
		if (current.startsWith("!")) {
			negate = true;
			current = current.slice(1);
		}
		if (!current) continue;
		if (globToRegExp(current).test(matchPath)) {
			matched = !negate;
			pattern = negate ? undefined : current;
		}
	}
	return { protected: matched, pattern };
}

export interface PathDecision {
	action: "block" | "confirm";
	reason: string;
	/** Stable identity used for per-session confirmation memory. */
	detail: string;
	pattern: string;
}

/** Decide whether a write/edit target is protected. */
export function decidePath(absPath: string, cwd: string, config: GuardConfig): PathDecision | undefined {
	if (config.protected.paths.length === 0) return undefined;
	const matchPath = toMatchPath(absPath, cwd);
	const match = matchProtectedPath(matchPath, config.protected.paths);
	if (!match.protected || !match.pattern) return undefined;
	return {
		action: config.protected.action,
		reason: `"${matchPath}" matches protected pattern "${match.pattern}"`,
		detail: matchPath,
		pattern: match.pattern,
	};
}
