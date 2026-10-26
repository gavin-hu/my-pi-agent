/**
 * Reading a shell command line: its words, its segments, and its redirection targets.
 *
 * The isolation guards in `guard.ts` ask questions about a command through this module and
 * never re-lex it themselves: one reader, so "where does this command go" has one answer.
 * A quoted word keeps whether it began inside quotes, and anything that cannot be expanded
 * statically is reported as unresolved rather than guessed at.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isInside } from "../../lib/path.ts";
import { isShellEscapable } from "../../lib/shell.ts";

// ---------------------------------------------------------------------------
// Shell commands (checks 2-4)
// ---------------------------------------------------------------------------

/** One shell word, with whether it began inside a quote (a quoted literal). */
export interface ShellWord {
	text: string;
	leadingQuoted: boolean;
}

/** Split a command on unquoted `;`, `&`, `|`, and newlines, preserving quotes. */
export function splitSegments(command: string): string[] {
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
export function tokenize(segment: string): ShellWord[] {
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
export function expandShellPath(raw: string): { path?: string; unresolved: boolean } {
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
export function pathEscapes(root: string, raw: string): boolean {
	const expanded = expandShellPath(raw);
	if (expanded.unresolved || !expanded.path) return true;
	return !isInside(root, resolve(root, expanded.path));
}

/**
 * Constructs whose text does not spell out the git command that runs. Exported
 * so the `tool_call` handler counts exactly the commands this check would have
 * refused, instead of guessing at a second list.
 */
export function isUnverifiable(command: string): boolean {
	return /\$\(|`|\$\{!|\beval\b|\b(?:sh|bash|zsh|dash|ksh)\s+-c\b/.test(command);
}

/**
 * Redirection targets: the paths a command writes to or reads from.
 *
 * The output and input operators name a path; descriptor duplication, a heredoc delimiter,
 * and a here-string do not, so those are skipped rather than reported as an escape.
 */

// ---------------------------------------------------------------------------
// Shell redirections (check 1b)
// ---------------------------------------------------------------------------

export interface Redirect {
	target: string;
	/** True for output/read-write redirections; false for input-only. */
	write: boolean;
}

/** Read a shell word starting at `start`, skipping leading blanks, unquoting the result. */
export function readShellWord(text: string, start: number): { raw: string; end: number } {
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
export function redirectionTargets(segment: string): Redirect[] {
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

/** The wrappers and assignment shapes a policy reads through. */
/** Commands that wrap another command, so a following assignment is still a prefix. */
export const COMMAND_WRAPPERS = new Set(["sudo", "doas", "env", "command", "builtin", "exec", "nohup", "nice", "time"]);

export function isAssignment(word: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}
