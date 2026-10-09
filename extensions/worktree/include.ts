/**
 * `.worktreeinclude` support.
 *
 * A worktree is a fresh checkout, so untracked, gitignored files (`.env`,
 * local config) are missing. `.worktreeinclude` at the repository root lists
 * them with gitignore syntax. Only files that match a pattern AND are ignored
 * by git are copied, so tracked files are never duplicated.
 */

import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function escapeRegExp(char: string): string {
	return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Translate one gitignore-style pattern into a regular expression over a repo-relative posix path. */
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
			// Backslash escapes the next character literally.
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
			// `-` is kept for ranges; regex-significant characters are escaped.
			re += `[${negate ? "^" : ""}${set.replace(/[\\\]^]/g, "\\$&")}]`;
		} else {
			re += escapeRegExp(char);
		}
	}

	const prefix = anchored ? "" : "(?:.*/)?";
	const suffix = dirOnly ? "(?:/.*)?" : "";
	return new RegExp(`^${prefix}${re}${suffix}$`);
}

/** Read `.worktreeinclude` from the repo root, falling back to the config list. */
export function includePatterns(repoRoot: string, fallback: string[]): string[] {
	const file = join(repoRoot, ".worktreeinclude");
	if (!existsSync(file)) return fallback;
	try {
		return readFileSync(file, "utf-8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("#"));
	} catch {
		return fallback;
	}
}

/** Last match wins, so `!` can re-include a path. */
export function isIncluded(relPath: string, patterns: string[]): boolean {
	let matched = false;
	for (const raw of patterns) {
		let pattern = raw;
		let negate = false;
		if (pattern.startsWith("!")) {
			negate = true;
			pattern = pattern.slice(1);
		}
		if (!pattern) continue;
		if (globToRegExp(pattern).test(relPath)) matched = !negate;
	}
	return matched;
}

/**
 * Copy every ignored file matching `patterns` from the main checkout into the
 * worktree, creating directories as needed and never overwriting an existing
 * file. Returns the copied repo-relative paths.
 */
export async function copyIncludes(
	pi: ExtensionAPI,
	repoRoot: string,
	worktreeDir: string,
	patterns: string[],
	excludePrefix?: string,
): Promise<string[]> {
	if (patterns.length === 0) return [];

	const listed = await pi.exec("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {
		cwd: repoRoot,
	});
	if (listed.code !== 0) return [];

	const excluded = excludePrefix?.replace(/\/+$/, "");
	const copied: string[] = [];
	for (const rel of listed.stdout.split("\0")) {
		if (!rel) continue;
		if (excluded && (rel === excluded || rel.startsWith(`${excluded}/`))) continue;
		if (!isIncluded(rel, patterns)) continue;
		const source = join(repoRoot, rel);
		const destination = join(worktreeDir, rel);
		if (existsSync(destination) || !existsSync(source)) continue;
		try {
			mkdirSync(dirname(destination), { recursive: true });
			const stat = lstatSync(source);
			if (stat.isSymbolicLink()) {
				symlinkSync(readlinkSync(source), destination);
			} else {
				copyFileSync(source, destination);
			}
			copied.push(rel);
		} catch {
			// A single unreadable file should not abort entering the worktree.
		}
	}
	return copied;
}
