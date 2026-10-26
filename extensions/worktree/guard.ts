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
 *   4. (optional) commands whose text cannot be statically verified;
 *   5. the un-re-rooted `powershell` tool, which has no guard of its own.
 */

import { isAbsolute, resolve } from "node:path";
import { isInside, isInsideReal, realPathOfNearest } from "../../lib/path.ts";
import { WORKSPACE_READERS } from "../../lib/policy.ts";
import type { WorktreeConfig } from "./config.ts";
import {
	COMMAND_WRAPPERS,
	isAssignment,
	isUnverifiable,
	pathEscapes,
	redirectionTargets,
	splitSegments,
	type ShellWord,
	tokenize,
} from "./shell.ts";

// The reader's public names, so a caller keeps importing the guards from here.
export { isUnverifiable };
export type { Redirect, ShellWord } from "./shell.ts";

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

/** The file tools and the one argument that carries their path. */
const PATH_FIELD: Record<string, string> = {
	...Object.fromEntries(WORKSPACE_READERS.map((name): [string, string] => [name, "path"])),
	write: "path",
	edit: "path",
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

/** Refuse an output/input redirection whose target leaves the worktree. */
function redirectionEscapes(root: string, command: string, config: WorktreeConfig): string | undefined {
	const checkWrites = config.guard.blockFileEscapes;
	const checkReads = config.guard.blockReadEscapes;
	if (!checkWrites && !checkReads) return undefined;
	for (const segment of splitSegments(command)) {
		for (const redirect of redirectionTargets(segment)) {
			if (redirect.write ? !checkWrites : !checkReads) continue;
			if (isNullDevice(redirect.target)) continue;
			if (pathEscapes(root, redirect.target)) {
				return `${redirect.write ? "Output" : "Input"} redirection to \"${redirect.target}\" leaves the active worktree.`;
			}
		}
	}
	return undefined;
}

/**
 * The null device discards the stream instead of writing a file, so a redirect
 * there escapes nothing — and `2>/dev/null` is too common to refuse. Quotes are
 * stripped because the target keeps them as written.
 */
function isNullDevice(raw: string): boolean {
	return raw.replace(/^(['"])(.*)\1$/, "$2") === "/dev/null";
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

/** Shell builtins that export an assignment for every later command in the shell. */
const ENV_BUILTINS = new Set(["export", "declare", "typeset", "local"]);

/**
 * An `export GIT_DIR=...` / `export GIT_WORK_TREE=...` that points outside.
 * Unlike a command-prefix assignment, this sets the environment for the whole
 * shell, so the later `git` segment never sees the assignment itself.
 */
function exportedGitRedirect(root: string, command: string): string | undefined {
	for (const segment of splitSegments(command)) {
		const words = tokenize(segment);
		if (!words.some((word) => ENV_BUILTINS.has(word.text))) continue;
		for (const word of words) {
			const match = word.text.match(/^(GIT_DIR|GIT_WORK_TREE)=(.+)$/);
			if (match && pathEscapes(root, match[2])) {
				return `exported ${match[1]}=${match[2]} redirects git outside the worktree.`;
			}
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

// ---------------------------------------------------------------------------
// The powershell tool (check 5)
// ---------------------------------------------------------------------------

/**
 * Refuse the `powershell` tool while isolated.
 *
 * Pi's `powershell` tool is neither re-rooted nor guarded: it is not in
 * `ROOT_TOOL_NAMES`, and its language is a second grammar — backtick escapes,
 * `Set-Location`, `$env:GIT_DIR`, `--%` — so `analyzeBashCommand` would be
 * guessing. Inside a worktree its relative paths therefore resolve at the main
 * checkout, the checkout isolation exists to protect.
 *
 * Re-rooting it without a parser would be worse than refusing it: it would look
 * isolated while every one of those forms still walks out. So the isolated
 * session refuses the tool, the same answer plan mode gives, and
 * `guard.blockPowershell: false` is the documented opt-out — which `gaps.ts`
 * reports and `doctor` shows as `degraded`.
 */
export function guardPowershellTool(config: WorktreeConfig): GuardBlock | undefined {
	if (!config.guard.blockPowershell) return undefined;
	return {
		block: true,
		reason:
			"Refusing to run powershell inside an isolated worktree: it is not re-rooted or guarded, " +
			"so relative paths and git would run against the main checkout. " +
			"Use bash, which is re-rooted and guarded, or exit the worktree first. " +
			"(worktree.guard.blockPowershell turns this refusal off.)",
	};
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
		const exported = exportedGitRedirect(root, command);
		if (exported) {
			return { block: true, reason: `${exported} Exit the worktree to operate on the main checkout.` };
		}
	}

	const redirect = redirectionEscapes(root, command, config);
	if (redirect) {
		return { block: true, reason: `${redirect} Exit the worktree to operate on the main checkout.` };
	}

	if (config.guard.blockUnparsableCommands && isUnverifiable(command)) {
		return {
			block: true,
			reason:
				"Refusing a command whose git behavior cannot be verified (command substitution, backticks, eval, or ${!...}). " +
				"Rewrite it as plain, separate commands.",
		};
	}

	return undefined;
}
