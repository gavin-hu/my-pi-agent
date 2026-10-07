/**
 * Read-only command assessment for plan mode (pure).
 *
 * This is a guard rail, not a sandbox: an extension shares Pi's OS
 * permissions. The goal is to stop accidental writes while planning, not to
 * contain a hostile command. `analyzeCommand` splits a command line into
 * segments, requires every segment's first word to be on a read-only
 * allowlist, and rejects argument-level escape hatches (command substitution,
 * `find -exec`, `sed -i`, output redirection to a file, mutating git/package
 * subcommands).
 *
 * The rule tables live in `./safety-rules.ts`.
 */

import {
	ALLOWED,
	BRANCH_LIST_FLAGS,
	COMMAND_ARG_DENY,
	GIT_CONFIG_READ,
	GIT_READ,
	PACKAGE_READ,
	SHELL_DENY,
	VERSION_ONLY,
} from "./safety-rules.ts";

export interface CommandAssessment {
	safe: boolean;
	/** Why the command was rejected, when `safe` is false. */
	reason?: string;
}

/**
 * Split a command line into segments on `;`, `&&`, `||`, `|`, and newlines,
 * respecting single/double quotes and backslash escapes.
 */
export function splitSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: string | null = null;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			current += ch;
			if (ch === "\\" && quote === '"' && i + 1 < command.length) {
				current += command[++i];
			} else if (ch === quote) {
				quote = null;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			current += ch;
			continue;
		}
		if (ch === "\\" && i + 1 < command.length) {
			current += ch + command[++i];
			continue;
		}
		if (ch === ";" || ch === "\n") {
			segments.push(current);
			current = "";
			continue;
		}
		if (ch === "&") {
			if (command[i + 1] === "&") {
				segments.push(current);
				current = "";
				i++;
				continue;
			}
			// `>&` (file-descriptor duplication) and `&>` (combined redirect) are
			// redirection syntax, not command list separators.
			if (command[i - 1] === ">" || command[i + 1] === ">") {
				current += ch;
				continue;
			}
			segments.push(current);
			current = "";
			continue;
		}
		if (ch === "|") {
			if (command[i + 1] === "|") i++;
			segments.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	segments.push(current);
	return segments.map((segment) => segment.trim()).filter(Boolean);
}

/**
 * Blank out single-quoted spans so shell-level rules only see text the shell
 * actually expands. Double-quoted content is kept, because `$(...)` and
 * backticks are still live there.
 */
function codeOnly(command: string): string {
	let out = "";
	let quote: "'" | '"' | null = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote === "'") {
			out += " ";
			if (ch === "'") quote = null;
			continue;
		}
		if (quote === '"') {
			if (ch === "\\") {
				out += ch + (command[i + 1] ?? "");
				i++;
				continue;
			}
			out += ch;
			if (ch === '"') quote = null;
			continue;
		}
		if (ch === "'") {
			quote = "'";
			out += " ";
			continue;
		}
		if (ch === '"') {
			quote = '"';
			out += ch;
			continue;
		}
		if (ch === "\\") {
			out += ch + (command[i + 1] ?? "");
			i++;
			continue;
		}
		out += ch;
	}
	return out;
}

/** Reject output redirection, except to `/dev/null` and fd duplication. */
function findWriteRedirect(command: string): string | undefined {
	let quote: string | null = null;
	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		if (quote) {
			if (ch === "\\" && quote === '"') i++;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") {
			quote = ch;
			continue;
		}
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch !== ">") continue;
		let j = i + 1;
		while (command[j] === ">") j++;
		while (command[j] === " ") j++;
		const rest = command.slice(j);
		if (rest.startsWith("&")) continue;
		if (rest.startsWith("/dev/null") || rest.startsWith("/dev/stderr") || rest.startsWith("/dev/stdout")) continue;
		return "writing with '>' is not allowed in plan mode";
	}
	return undefined;
}

/** Reason a `git` invocation is unsafe, if any. */
function validateGit(_command: string, args: string[]): string | undefined {
	const sub = args[0];
	if (!sub) return undefined;
	if (!GIT_READ.has(sub)) return `"git ${sub}" is not a read-only git command`;
	if (sub === "config" && !args.some((arg) => GIT_CONFIG_READ.has(arg))) {
		return '"git config" is only allowed with a read flag';
	}
	if (sub === "branch") {
		const rest = args.slice(1);
		// Only listing flags are allowed; a bare positional argument names a
		// branch to create, rename, or delete.
		for (let i = 0; i < rest.length; i++) {
			const arg = rest[i];
			if (arg.startsWith("-")) {
				if (BRANCH_LIST_FLAGS.has(arg)) i++;
				continue;
			}
			return '"git branch" may only list branches';
		}
	}
	if (sub === "remote" && args.some((arg) => ["add", "remove", "rm", "set-url", "rename", "set-head", "prune"].includes(arg))) {
		return '"git remote" may not be modified';
	}
	if (sub === "worktree" && args.some((arg) => ["add", "remove", "prune", "move", "repair", "lock", "unlock"].includes(arg))) {
		return '"git worktree" may only be listed';
	}
	return undefined;
}

/** Reason a package-manager invocation is unsafe, if any. */
function validatePackage(command: string, args: string[]): string | undefined {
	const sub = args[0];
	if (!sub) return undefined;
	if (!PACKAGE_READ[command].has(sub)) return `"${command} ${sub}" is not a read-only ${command} command`;
	return undefined;
}

/** Reason an interpreter invocation is unsafe, if any. */
function validateVersionOnly(command: string, args: string[]): string | undefined {
	if (!args.some((arg) => arg === "--version" || arg === "-V")) return `"${command}" is only allowed with --version`;
	return undefined;
}

/** Reason a `wget` invocation is unsafe, if any (must print to stdout). */
function validateWget(_command: string, args: string[]): string | undefined {
	if (!wgetWritesToStdout(args)) return '"wget" must write to stdout with -O - in plan mode';
	return undefined;
}

type Validator = (command: string, args: string[]) => string | undefined;

const VALIDATORS: Record<string, Validator> = {
	git: validateGit,
	npm: validatePackage,
	yarn: validatePackage,
	pnpm: validatePackage,
	bun: validatePackage,
	wget: validateWget,
};
for (const name of VERSION_ONLY) VALIDATORS[name] = validateVersionOnly;

/** Whether a `wget` invocation sends its download to stdout (`-O -`). */
function wgetWritesToStdout(args: string[]): boolean {
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--output-document") return args[i + 1] === "-";
		if (arg.startsWith("--output-document=")) return arg.slice("--output-document=".length) === "-";
		if (arg.startsWith("-") && !arg.startsWith("--")) {
			const cluster = arg.slice(1);
			const index = cluster.indexOf("O");
			if (index === -1) continue;
			const attached = cluster.slice(index + 1);
			if (attached === "-") return true;
			if (attached === "") return args[i + 1] === "-";
			return false;
		}
	}
	return false;
}

/** Assess one segment; returns a rejection reason or undefined. */
function assessSegment(segment: string): string | undefined {
	const tokens = segment.split(/\s+/);
	let i = 0;
	while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
	const command = tokens[i];
	if (!command) return undefined;
	if (!ALLOWED.has(command)) return `"${command}" is not on the read-only allowlist`;

	const args = tokens.slice(i + 1);
	const validator = VALIDATORS[command];
	if (validator) {
		const reason = validator(command, args);
		if (reason) return reason;
	}
	for (const { pattern, reason } of COMMAND_ARG_DENY[command] ?? []) {
		if (pattern.test(segment)) return reason;
	}
	return undefined;
}

/** Assess a full command line for safe, read-only use in plan mode. */
export function analyzeCommand(command: string): CommandAssessment {
	const trimmed = command.trim();
	if (!trimmed) return { safe: false, reason: "the command is empty" };

	const redirect = findWriteRedirect(trimmed);
	if (redirect) return { safe: false, reason: redirect };

	// Shell-level expansion is only live outside single quotes.
	const code = codeOnly(trimmed);
	for (const { pattern, reason } of SHELL_DENY) {
		if (pattern.test(code)) return { safe: false, reason };
	}

	for (const segment of splitSegments(trimmed)) {
		const reason = assessSegment(segment);
		if (reason) return { safe: false, reason };
	}
	return { safe: true };
}

/** Convenience wrapper. */
export function isSafeCommand(command: string): boolean {
	return analyzeCommand(command).safe;
}
