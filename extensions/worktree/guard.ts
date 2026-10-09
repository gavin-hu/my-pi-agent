/**
 * Isolation guards for the worktree extension.
 *
 * These are the enforcement layer, run from the `tool_call` handler. They stop
 * a tool call from reaching the main checkout even though the tool overrides in
 * `root-tools.ts` already re-root relative paths:
 *
 *   1. file edits that resolve outside the active worktree (absolute paths);
 *   2. a shell command whose working directory leaves the worktree;
 *   3. git commands redirected at the main checkout;
 *   4. (optional) commands whose text cannot be statically verified.
 */

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isInside, isInsideReal, realPathOfNearest } from "../../lib/path.ts";
import { isShellEscapable } from "../../lib/shell.ts";
import type { WorktreeConfig } from "./config.ts";

export interface GuardBlock {
	block: true;
	reason: string;
}

/** Resolve a tool path argument against the worktree root (undefined path = root). */
export function resolveUnder(root: string, path: string | undefined): string {
	if (path === undefined || path === "") return root;
	return isAbsolute(path) ? resolve(path) : resolve(root, path);
}

// ---------------------------------------------------------------------------
// File tools (check 1)
// ---------------------------------------------------------------------------

const PATH_FIELD: Record<string, string> = {
	read: "path",
	read_doc: "path",
	write: "path",
	edit: "path",
	grep: "path",
	find: "path",
	ls: "path",
};

const WRITE_TOOLS = new Set(["write", "edit"]);

/** Check 1: refuse a path-taking tool that resolves outside the worktree. */
export function guardFileTool(
	name: string,
	input: Record<string, unknown>,
	root: string,
	config: WorktreeConfig,
): GuardBlock | undefined {
	const field = PATH_FIELD[name];
	if (!field) return undefined;
	const isWrite = WRITE_TOOLS.has(name);
	if (isWrite && !config.guard.blockFileEscapes) return undefined;
	if (!isWrite && !config.guard.blockReadEscapes) return undefined;

	const resolved = resolveUnder(root, input[field] as string | undefined);
	if (!isInside(root, resolved)) {
		return {
			block: true,
			reason:
				`Refusing to run ${name} outside the active worktree.\n` +
				`  requested: ${resolved}\n` +
				`  worktree:  ${root}\n` +
				`Use a path relative to the worktree, or exit the worktree first.`,
		};
	}
	if (config.guard.blockSymlinkEscapes && !isInsideReal(root, resolved)) {
		return {
			block: true,
			reason:
				`Refusing to run ${name} through a symlink that leaves the active worktree.\n` +
				`  requested: ${resolved}\n` +
				`  real path: ${realPathOfNearest(resolved)}\n` +
				`  worktree:  ${root}`,
		};
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Shell commands (checks 2-4)
// ---------------------------------------------------------------------------

/** One shell word, with whether it began inside a quote (a quoted literal). */
interface ShellWord {
	text: string;
	leadingQuoted: boolean;
}

/** Split a command on unquoted `;`, `&`, `|`, and newlines, preserving quotes. */
function splitSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			current += ch;
			if (ch === "\\" && quote === '"' && i + 1 < command.length) {
				const next = command[i + 1];
				if (isShellEscapable(next)) current += command[++i];
			} else if (ch === quote) {
				quote = null;
			}
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			current += ch;
		} else if (ch === ";" || ch === "\n") {
			segments.push(current);
			current = "";
		} else if (ch === "&") {
			const prev = command[i - 1];
			const next = command[i + 1];
			if (next === "&") {
				// `&&` is a command separator.
				segments.push(current);
				current = "";
				i++;
			} else if (prev === ">" || prev === "<" || next === ">") {
				// `>&`, `<&`, `&>`: redirection, not a separator.
				current += ch;
			} else {
				// Background job `&`.
				segments.push(current);
				current = "";
			}
		} else if (ch === "|") {
			if (command[i + 1] === "&") i++; // `|&` is still a pipe separator.
			segments.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	segments.push(current);
	return segments;
}

/** Tokenize a shell segment into words, removing quotes and tracking quoted leads. */
function tokenize(segment: string): ShellWord[] {
	const words: ShellWord[] = [];
	let current = "";
	let leadingQuoted = false;
	let started = false;
	let quote: string | null = null;
	const push = () => {
		if (started) words.push({ text: current, leadingQuoted });
		current = "";
		leadingQuoted = false;
		started = false;
	};
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (quote) {
			if (ch === "\\" && quote === '"' && i + 1 < segment.length) {
				const next = segment[i + 1];
				if (isShellEscapable(next)) current += segment[++i];
				else current += ch;
			} else if (ch === quote) {
				quote = null;
			} else {
				current += ch;
			}
			continue;
		}
		if (ch === "'" || ch === '"') {
			if (!started) {
				started = true;
				leadingQuoted = true;
			}
			quote = ch;
		} else if (ch === " " || ch === "\t") {
			push();
		} else if (ch === "\\" && i + 1 < segment.length) {
			started = true;
			const next = segment[i + 1];
			if (isShellEscapable(next)) current += segment[++i];
			else current += ch;
		} else {
			started = true;
			current += ch;
		}
	}
	push();
	return words;
}

/**
 * Expand `~` and environment variables so a path that only leaves the worktree
 * after shell expansion is still caught. `unresolved` marks a value that cannot
 * be expanded statically (unknown variable, `$`, backtick, `~user`); callers
 * treat it as escaping, because guessing could allow a bypass.
 */
function expandShellPath(raw: string): { path?: string; unresolved: boolean } {
	let value = raw;
	if (value === "~") value = homedir();
	else if (value.startsWith("~/")) value = join(homedir(), value.slice(2));
	else if (value.startsWith("~")) return { unresolved: true };

	let unresolved = false;
	value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, plain) => {
		const name = braced ?? plain;
		const env = process.env[name];
		if (env === undefined) {
			unresolved = true;
			return match;
		}
		return env;
	});
	if (value.includes("$") || value.includes("`")) unresolved = true;
	return { path: value, unresolved };
}

/** Whether a shell path argument leaves the worktree once expanded. */
function pathEscapes(root: string, raw: string): boolean {
	const expanded = expandShellPath(raw);
	if (expanded.unresolved || !expanded.path) return true;
	return !isInside(root, resolve(root, expanded.path));
}

/** Check 4: constructs whose text does not spell out the git command that runs. */
function looksUnparsable(command: string): boolean {
	return /\$\(|`|\$\{!|\beval\b/.test(command);
}

// ---------------------------------------------------------------------------
// Shell redirections (check 1b)
// ---------------------------------------------------------------------------

interface Redirect {
	target: string;
	/** True for output/read-write redirections; false for input-only. */
	write: boolean;
}

/** Read a shell word starting at `start`, skipping leading blanks, unquoting the result. */
function readShellWord(text: string, start: number): { raw: string; end: number } {
	let i = start;
	while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
	let raw = "";
	let quote: string | null = null;
	while (i < text.length) {
		const ch = text[i];
		if (quote) {
			if (ch === "\\" && quote === '"' && i + 1 < text.length) {
				const next = text[i + 1];
				if (isShellEscapable(next)) {
					raw += next;
					i += 2;
				} else {
					raw += ch;
					i += 1;
				}
				continue;
			}
			if (ch === quote) {
				quote = null;
				i++;
				continue;
			}
			raw += ch;
			i++;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			i++;
			continue;
		}
		if (ch === "\\" && i + 1 < text.length) {
			const next = text[i + 1];
			if (isShellEscapable(next)) {
				raw += next;
				i += 2;
			} else {
				raw += ch;
				i += 1;
			}
			continue;
		}
		if (ch === " " || ch === "\t") break;
		raw += ch;
		i++;
	}
	return { raw, end: i };
}

/**
 * File redirection targets in one shell segment. File-descriptor duplications
 * (`2>&1`), heredocs (`<<EOF`), and here-strings (`<<<x`) are skipped because
 * their operand is not a path.
 */
function redirectionTargets(segment: string): Redirect[] {
	const redirects: Redirect[] = [];
	let quote: string | null = null;
	for (let i = 0; i < segment.length; i++) {
		const ch = segment[i];
		if (quote) {
			if (ch === "\\" && quote === '"' && i + 1 < segment.length) {
				i++;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch !== ">" && ch !== "<") continue;

		const two = segment.slice(i, i + 2);
		const three = segment.slice(i, i + 3);
		if (three === "<<<") {
			i += 2;
			continue;
		}
		if (two === "<<") {
			// Heredoc delimiter: not a path.
			i += 1;
			continue;
		}
		if (two === ">&" || two === "<&") {
			// File-descriptor duplication (`2>&1`, `>&-`) is not a path, but bash
			// treats `>&file` as `&>file` (stdout+stderr to a file).
			const operand = readShellWord(segment, i + 2);
			if (operand.raw === "" || /^\d+$/.test(operand.raw) || operand.raw === "-") {
				i += 1;
				continue;
			}
			redirects.push({ target: operand.raw, write: ch === ">" });
			i = operand.end - 1;
			continue;
		}
		// `>`, `>>`, `>|`, `<`, `<>`: the next word is a path.
		const write = ch === ">" || two === "<>";
		if (two === ">>" || two === ">|") i += 1;
		const word = readShellWord(segment, i + 1);
		if (word.raw) redirects.push({ target: word.raw, write });
		i = word.end - 1;
	}
	return redirects;
}

/** Refuse an output/input redirection whose target leaves the worktree. */
function redirectionEscapes(root: string, command: string, config: WorktreeConfig): string | undefined {
	const checkWrites = config.guard.blockFileEscapes;
	const checkReads = config.guard.blockReadEscapes;
	if (!checkWrites && !checkReads) return undefined;
	for (const segment of splitSegments(command)) {
		for (const redirect of redirectionTargets(segment)) {
			if (redirect.write ? !checkWrites : !checkReads) continue;
			if (pathEscapes(root, redirect.target)) {
				return `${redirect.write ? "Output" : "Input"} redirection to \"${redirect.target}\" leaves the active worktree.`;
			}
		}
	}
	return undefined;
}

/** Commands that wrap another command, so a following assignment is still a prefix. */
const COMMAND_WRAPPERS = new Set(["sudo", "doas", "env", "command", "builtin", "exec", "nohup", "nice", "time"]);

function isAssignment(word: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

/** A leading `GIT_DIR=`/`GIT_WORK_TREE=` assignment that points outside. */
function envGitRedirect(root: string, words: ShellWord[]): string | undefined {
	for (let i = 0; i < words.length; i++) {
		const word = words[i];
		if (word.leadingQuoted) continue;
		const match = word.text.match(/^(GIT_DIR|GIT_WORK_TREE)=(.+)$/);
		if (!match) continue;
		// Only a real command-prefix assignment counts: every preceding word must be
		// another assignment, a wrapper, or a wrapper option, so `echo GIT_DIR=/x`
		// is not a redirect.
		const isPrefix = words
			.slice(0, i)
			.every((w) => isAssignment(w.text) || COMMAND_WRAPPERS.has(w.text) || w.text.startsWith("-"));
		if (isPrefix && pathEscapes(root, match[2])) {
			return `${match[1]}=${match[2]} redirects git outside the worktree.`;
		}
	}
	return undefined;
}

/** `-c core.worktree=<dir>` moves the working tree, like `--work-tree`. */
function gitConfigRedirect(root: string, flag: string, value: string | undefined): string | undefined {
	if (!value) return undefined;
	const match = value.match(/^core\.worktree=(.*)$/i);
	if (match && pathEscapes(root, match[1])) {
		return `${flag} core.worktree=${match[1]} redirects git outside the worktree.`;
	}
	return undefined;
}

/**
 * `git -C`, `--git-dir`, and `--work-tree` before the subcommand. Scanning stops
 * at the first non-option word, so `git log -C` (copy detection) is not a
 * redirect and a quoted `--git-dir=...` argument is not mistaken for one.
 */
function gitRedirect(root: string, words: ShellWord[]): string | undefined {
	const gitIndex = words.findIndex((word) => word.text === "git" || word.text.endsWith("/git"));
	if (gitIndex === -1) return undefined;

	for (let i = gitIndex + 1; i < words.length; i++) {
		const word = words[i];
		if (word.text === "--") break;

		if (word.text === "-C") {
			const value = words[i + 1];
			if (value && pathEscapes(root, value.text)) return `git -C ${value.text} redirects into the main checkout.`;
			i++;
			continue;
		}
		if (word.text.startsWith("-C") && word.text.length > 2) {
			const value = word.text.slice(2);
			if (pathEscapes(root, value)) return `git -C ${value} redirects into the main checkout.`;
			continue;
		}
		if (word.text === "--git-dir" || word.text === "--work-tree") {
			const value = words[i + 1];
			if (value && pathEscapes(root, value.text)) return `${word.text} redirects git outside the worktree.`;
			i++;
			continue;
		}
		if (word.text.startsWith("--git-dir=") || word.text.startsWith("--work-tree=")) {
			const value = word.text.slice(word.text.indexOf("=") + 1);
			if (pathEscapes(root, value)) {
				return `${word.text.slice(0, word.text.indexOf("="))} redirects git outside the worktree.`;
			}
			continue;
		}
		if (word.text === "-c" || word.text === "--config-env") {
			const reason = gitConfigRedirect(root, word.text, words[i + 1]?.text);
			if (reason) return reason;
			i++;
			continue;
		}
		if (word.text.startsWith("-c") && word.text.length > 2) {
			const reason = gitConfigRedirect(root, "-c", word.text.slice(2));
			if (reason) return reason;
			continue;
		}
		if (word.text === "--namespace" || word.text === "--exec-path" || word.text.startsWith("--config-env=")) {
			i++;
			continue;
		}
		if (!word.text.startsWith("-")) break; // the subcommand
	}
	return undefined;
}

const CD_LIKE = new Set(["cd", "pushd", "popd"]);

/**
 * A directory change that leaves the worktree. Handles `cd`/`pushd`/`popd`
 * under `command`/`builtin`/`exec`, a leading `!`, and opening `(`/`{` group
 * punctuation, so `(cd /main)` and `{ cd /main; }` are caught too.
 */
function cdRedirect(root: string, words: ShellWord[]): string | undefined {
	let i = 0;
	while (i < words.length) {
		const text = words[i].text.replace(/^[({!]+/, "");
		if (text === "" || text === "command" || text === "builtin" || text === "exec") {
			i++;
			continue;
		}
		break;
	}
	const command = words[i]?.text.replace(/^[({]+/, "").replace(/\)+$/, "");
	if (!command || !CD_LIKE.has(command)) return undefined;

	if (command === "popd") return "popd returns to a directory that may be outside the worktree.";

	// Skip options (`cd -P`, `pushd -n`) and an optional end-of-options `--`, so
	// the real target is checked instead of the option.
	let j = i + 1;
	while (j < words.length) {
		const text = words[j].text.replace(/\)+$/, "");
		if (text === "--") {
			j++;
			continue;
		}
		if (text.length > 1 && text.startsWith("-") && text[1] !== "-") {
			j++;
			continue;
		}
		break;
	}
	const target = words[j]?.text.replace(/\)+$/, "");
	if (!target) {
		return command === "pushd"
			? "pushd with no target swaps directories without telling the guard where."
			: "cd with no target goes to $HOME, outside the worktree.";
	}
	if (target === "-") return `${command} - goes to a previous directory, outside the worktree.`;
	if (pathEscapes(root, target)) return `${command} ${target} leaves the active worktree.`;
	return undefined;
}

/** Checks 2-4 for a bash command while isolated. */
export function analyzeBashCommand(command: string, root: string, config: WorktreeConfig): GuardBlock | undefined {
	if (config.guard.blockGitRedirects) {
		for (const segment of splitSegments(command)) {
			const words = tokenize(segment);
			const reason = envGitRedirect(root, words) ?? gitRedirect(root, words) ?? cdRedirect(root, words);
			if (reason) {
				return { block: true, reason: `${reason} Exit the worktree to operate on the main checkout.` };
			}
		}
	}

	const redirect = redirectionEscapes(root, command, config);
	if (redirect) {
		return { block: true, reason: `${redirect} Exit the worktree to operate on the main checkout.` };
	}

	if (config.guard.blockUnparsableCommands && looksUnparsable(command)) {
		return {
			block: true,
			reason:
				"Refusing a command whose git behavior cannot be verified (command substitution, backticks, eval, or ${!...}). " +
				"Rewrite it as plain, separate commands.",
		};
	}

	return undefined;
}
