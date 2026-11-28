/**
 * One shell command judged read-only git — the guard a mode without code puts on
 * `bash` (pure).
 *
 * Plan mode keeps the path-taking readers but, historically, disabled raw shell
 * entirely and relied on a structured `git` tool for repository inspection. With
 * that tool removed, this guard lets `bash` run read-only git commands instead.
 * Lead mode needs the same permission for the same reason: a lead vets a handed
 * sha with `git log` and `git diff`, and nothing else. Several commands may be
 * chained with `&&` or `;`, but every segment must itself be read-only.
 *
 * What a refusal is called is the caller's: the grammar is mode-neutral and
 * {@link ModePhrasing} supplies the two clauses plan mode and lead mode word
 * differently, so plan's rendered sentences are byte-identical to the ones it
 * shipped and a second mode reads its own.
 *
 * It is deliberately conservative and allowlist-based:
 *
 *   1. `&&`/`;` split the command into segments; each segment must contain no
 *      other shell metacharacters (no pipes, substitution, or redirection). A
 *      backslash before an ordinary character is a literal separator, so a
 *      Windows path (`git diff -- extensions\plan`) survives, while a backslash
 *      that escapes whitespace, a quote, another backslash, or a metacharacter
 *      is still refused (see `lib/shell.ts`);
 *   2. each segment must start with `git` and name a read-only subcommand;
 *   3. a global option that is not a read-only subcommand is rejected — which is what
 *      refuses `-c`, `-O`, `--bare` and every retargeting form, since they are refused by
 *      position and not by name; past the subcommand only the options that can execute an
 *      external program or write a file are rejected, and dual-use subcommands (`branch`,
 *      `tag`, `remote`, `config`, `stash`, `worktree`, `reflog`) must be in their read-only
 *      form.
 *
 * This is a guard rail, not a sandbox. A few exotic read invocations are
 * refused on purpose rather than risking a bypass. It writes nothing of its own:
 * what it allows can still move `.git/index`, which `git status` and `git diff`
 * refresh, and that is git's record of the working tree rather than a write the
 * mode asks for.
 *
 * Two switches are forced onto every allowed command that runs a diff, because a
 * repository can otherwise name the program that runs: `--no-textconv` stops a
 * `diff.<driver>.textconv` helper and `--no-ext-diff` stops `diff.external`. They
 * are appended after the subcommand, so a caller cannot re-enable either — and the
 * denylist refuses `--textconv` and `--ext-diff` by name anyway.
 */

import { hasShellEscape } from "../../lib/shell.ts";

/** Verdict from one read-only git check, before the command is rewritten. */
type GitCheck = { ok: true } | { ok: false; reason: string; hint?: string };

/**
 * What the guard answers: the command to run, or why the caller may not.
 *
 * `hint` is an alternative the reason names none of — a refusal that told the caller what
 * not to do and nothing about what to do instead. It is mode-neutral and git-only, so a
 * caller may print it or ignore it: plan mode ignores it, and the seat prints it between
 * the reason and its own hatch.
 */
export type GitCommandVerdict = { ok: true; command: string } | { ok: false; reason: string; hint?: string };

/**
 * How a refusal names the mode it is judging for, so the grammar stays neutral.
 *
 * Plan mode passes `{ label: "plan mode", whileDoing: "while planning" }`, which
 * renders the sentences it shipped; lead mode passes its own two, and the same
 * check reads as the seat's rule rather than a planner's.
 */
export interface ModePhrasing {
	/** The mode, mid-sentence and lowercase: `plan mode`, `lead mode`. */
	label: string;
	/** A prohibition's clause: `while planning`, `in lead mode`. */
	whileDoing: string;
}

/**
 * Characters that chain commands, substitute, redirect, or form a subshell.
 * `&&`/`;` are handled as segment separators before this runs; any remaining
 * occurrence blocks (including inside quotes — a deliberate over-rejection).
 */
const SHELL_META = /[;&|<>`$(){}[\]\n\r]/;

/**
 * What a refusal calls the characters whose own literal would break the sentence — a raw backtick
 * ends the markup around it, a newline ends the line. The rest print as themselves.
 */
const META_NAME: Partial<Record<string, string>> = {
	"`": "a backtick",
	"\\": "a backslash",
	"\n": "a line break",
	"\r": "a carriage return",
};

/** `git` subcommands that only read repository state. */
const READ_ONLY_SUBCOMMANDS = new Set([
	"status",
	"diff",
	"log",
	"show",
	"branch",
	"reflog",
	"tag",
	"stash",
	"worktree",
	"remote",
	"config",
	"rev-parse",
	"describe",
	"blame",
	"grep",
	"shortlog",
	"whatchanged",
	"ls-files",
	"ls-tree",
	"cat-file",
	"for-each-ref",
	"count-objects",
	"merge-base",
	"name-rev",
	"diff-tree",
	"diff-index",
	"diff-files",
	"show-ref",
	"var",
	"version",
]);

/** Options that execute an external program, retarget the repo, or write a file. */
const DANGEROUS_PREFIXES = [
	"--config-env",
	"--exec-path",
	"--upload-pack",
	"--receive-pack",
	"--git-dir",
	"--work-tree",
	"--namespace",
	"--output",
];

/**
 * Options refused wherever they appear: they retarget the repository, run a program, or
 * write a file.
 *
 * The denylist is judged by POSITION, which is why `-c`, `-O` and `--bare` are absent: they
 * are dangerous only in git's global slot, before the subcommand, and the read-only
 * subcommand check is what refuses them there. After it they are the subcommand's own flag —
 * `git grep -c` counts, `git log -c` asks for a combined diff, `git log -O<file>` reads an
 * order file — and where one is a write, as `git branch -c` copies a ref, that subcommand's
 * flag allowlist in {@link checkRest} is what refuses it. `git grep -O<pager>` is refused by
 * grep's own case for the same reason.
 */
const DANGEROUS_EXACT = new Set(["--ext-diff", "--textconv", "--filters"]);

function isDangerousOption(token: string): boolean {
	if (DANGEROUS_EXACT.has(token)) return true;
	if (/^--open-files-in-pager(?:=|$)/.test(token)) return true;
	return DANGEROUS_PREFIXES.some((prefix) => token === prefix || token.startsWith(`${prefix}=`));
}

/** Strips one layer of matching surrounding quotes from a token. */
function unquote(token: string): string {
	if (token.length >= 2) {
		const first = token[0];
		const last = token[token.length - 1];
		if ((first === '"' || first === "'") && first === last) return token.slice(1, -1);
	}
	return token;
}

/** Flags that take the following token as their value rather than a ref/pattern. */
const VALUE_FLAGS = new Set([
	"--contains",
	"--merged",
	"--no-merged",
	"--points-at",
	"--format",
	"--sort",
	"--column",
	"--abbrev",
	"--grep",
	"--author",
	"--since",
	"--until",
	"--max-count",
]);

interface RestCheck {
	/** Flags (without arguments) that are read-only. */
	flags: readonly string[];
	/** Whether bare positional tokens are allowed only when a list flag is present. */
	listFlags?: readonly string[];
	/** Whether the subcommand allows positional tokens at all (read-only reads). */
	allowPositionals?: boolean;
}

const BRANCH_FLAGS = [
	"-a",
	"--all",
	"-r",
	"--remote",
	"-v",
	"-vv",
	"--verbose",
	"-l",
	"--list",
	"--contains",
	"--merged",
	"--no-merged",
	"--points-at",
	"--format",
	"--sort",
	"--color",
	"--no-color",
	"--column",
	"--no-column",
	"--abbrev",
	"--no-abbrev",
	"--show-current",
];

const TAG_FLAGS = [
	"-l",
	"--list",
	"-n",
	"--contains",
	"--merged",
	"--no-merged",
	"--points-at",
	"--format",
	"--sort",
	"--color",
	"--no-color",
	"--column",
	"--no-column",
];

function checkFlagAndPositional(rest: string[], spec: RestCheck, label: string): GitCheck {
	const flags = new Set(spec.flags);
	const listFlags = new Set(spec.listFlags ?? []);
	let sawListFlag = rest.some((token) => listFlags.has(token));
	let expectValue = false;
	let sawBare = false;

	for (const raw of rest) {
		const token = unquote(raw);
		if (expectValue) {
			expectValue = false;
			continue;
		}
		if (token.startsWith("-")) {
			const inlineValue = [...VALUE_FLAGS].some((flag) => token.startsWith(`${flag}=`));
			if (!flags.has(token) && !inlineValue) {
				return { ok: false, reason: `"git ${label}" flag "${token}" is not a read-only option.` };
			}
			if (VALUE_FLAGS.has(token)) expectValue = true;
			if (listFlags.has(token)) sawListFlag = true;
			continue;
		}
		sawBare = true;
	}

	if (sawBare && !spec.allowPositionals && !sawListFlag) {
		return {
			ok: false,
			reason: `"git ${label}" with a name argument creates or changes a ref; use its listing form.`,
		};
	}
	return { ok: true };
}

/** `git config` flags that write the file, each of which the guard refuses by name. */
const CONFIG_WRITE_FLAGS = new Set([
	"--add",
	"--edit",
	"-e",
	"--remove-section",
	"--rename-section",
	"--replace-all",
	"--unset",
	"--unset-all",
]);

/** `git config` flags whose value is the next token, or the part after `=`. */
const CONFIG_VALUE_FLAGS = new Set([
	"--get",
	"--get-all",
	"--get-regexp",
	"--get-urlmatch",
	"--get-color",
	"--get-colorbool",
	"--default",
	"--file",
	"-f",
	"--type",
	"--blob",
]);

/** `git config` flags that select or shape a read without taking a value. */
const CONFIG_READ_FLAGS = new Set([
	"--list",
	"-l",
	"--show-origin",
	"--show-scope",
	"--name-only",
	"--null",
	"-z",
	"--local",
	"--global",
	"--system",
	"--worktree",
	"--includes",
	"--no-includes",
	"--bool",
	"--int",
	"--bool-or-int",
	"--path",
]);

/** `git config` flags that ask for a value rather than only shaping the output. */
const CONFIG_GET_FLAGS = new Set([
	"--get",
	"--get-all",
	"--get-regexp",
	"--get-urlmatch",
	"--get-color",
	"--get-colorbool",
]);

/**
 * `git config` reads only, by allowlist.
 *
 * Asking whether a read flag appeared *anywhere* let every write through beside one:
 * `git config --show-scope --replace-all core.fsmonitor /tmp/hook.sh` wrote `.git/config`
 * from inside plan mode, and the `git status` that followed ran the hook. Each flag is now
 * one this guard knows, a write action is refused by name, positionals are at most one, and
 * the only forms left are the ones git reads with: `--get*`, `--list`, or one bare name.
 */
function checkConfig(rest: string[], phrasing: ModePhrasing): GitCheck {
	const tokens = rest.map(unquote);
	const positionals: string[] = [];
	let reads = false;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		if (!token.startsWith("-")) {
			positionals.push(token);
			continue;
		}
		const [flag = "", inline] = token.split("=", 2);
		if (CONFIG_WRITE_FLAGS.has(flag)) {
			return {
				ok: false,
				reason: `"git config ${flag}" writes .git/config; "git config" may only read ${phrasing.whileDoing}.`,
			};
		}
		if (!CONFIG_READ_FLAGS.has(flag) && !CONFIG_VALUE_FLAGS.has(flag)) {
			return { ok: false, reason: `"git config" flag "${token}" is not a read-only option.` };
		}
		if (!CONFIG_VALUE_FLAGS.has(flag)) {
			if (flag === "--list" || flag === "-l") reads = true;
			continue;
		}
		if (CONFIG_GET_FLAGS.has(flag)) reads = true;
		if (inline !== undefined) continue;
		const value = tokens[index + 1];
		// A flag is not a value: reading `--replace-all` as `--get`'s key would refuse nothing
		// and leave git to act on it, so the value is refused rather than guessed.
		if (value === undefined || value.startsWith("-")) {
			return { ok: false, reason: `"git config ${flag}" needs a value, and ${phrasing.label} does not guess one.` };
		}
		index += 1;
	}
	if (positionals.length > 1) {
		return {
			ok: false,
			reason: `"git config <name> <value>" writes .git/config; ${phrasing.label} reads config only.`,
		};
	}
	if (!reads && positionals.length !== 1) {
		return {
			ok: false,
			reason: '"git config" may only read; use "git config <name>", --get, --get-all, --get-regexp, or --list.',
		};
	}
	return { ok: true };
}

/** Subcommand-specific read-only rules; the rest only pass the option denylist. */
function checkRest(subcommand: string, rest: string[], phrasing: ModePhrasing): GitCheck {
	switch (subcommand) {
		case "branch":
			return checkFlagAndPositional(rest, { flags: BRANCH_FLAGS, listFlags: ["-l", "--list"] }, "branch");
		case "tag":
			return checkFlagAndPositional(rest, { flags: TAG_FLAGS, listFlags: ["-l", "--list"] }, "tag");
		case "remote": {
			const [first] = rest.map(unquote);
			if (rest.length === 0) return { ok: true };
			if ((first === "-v" || first === "--verbose") && rest.length === 1) return { ok: true };
			// `show` opens the remote's connection and `get-url` reads a configured URL; `-v`
			// prints both URLs from config, so the narrowed form costs a plan nothing.
			return {
				ok: false,
				reason: `"git remote ${first}" reads beyond this repository's config; use "git remote -v" for the URLs.`,
			};
		}
		case "config":
			return checkConfig(rest, phrasing);
		case "stash": {
			const [first] = rest.map(unquote);
			if (first === "list" || first === "show") return { ok: true };
			return { ok: false, reason: '"git stash" mutates the tree; use "git stash list" or "git stash show".' };
		}
		case "worktree": {
			const [first] = rest.map(unquote);
			if (rest.length === 0 || first === "list") return { ok: true };
			return { ok: false, reason: '"git worktree" may only list; use "git worktree list".' };
		}
		case "reflog": {
			const [first] = rest.map(unquote);
			if (rest.length === 0 || first === "show") return { ok: true };
			return { ok: false, reason: '"git reflog" may only be read; use "git reflog" or "git reflog show".' };
		}
		case "grep": {
			// `-O` is its own token and is denied above; `git grep -O<pager>` and
			// `-O=<pager>` would still run an arbitrary command, so deny the prefix.
			const pager = rest.map(unquote).find((token) => token.startsWith("-O"));
			if (pager) {
				return { ok: false, reason: `"${pager}" opens a pager or runs a command; use the default output.` };
			}
			return { ok: true };
		}
		default:
			return { ok: true };
	}
}

/**
 * The forms that read a tree without moving the process or retargeting the repository.
 *
 * Offered by a refusal that used to name no alternative — `cd` and a global `-C`,
 * `--git-dir` or `--work-tree` — so the seat stops retrying against the same wall. The
 * sentence is mode-neutral: both modes print the reason, and only the seat prints this.
 */
const TREE_FORMS =
	"`git show <sha>:<path>`, `git log <branch>`, `git diff <a> <b> -- <path>` and `git ls-tree <sha>` read a tree without retargeting the repository.";

/** Whether a refused global option named a tree the by-revision forms could reach instead. */
function retargetsTree(token: string): boolean {
	if (token === "-C" || token === "--git-dir" || token === "--work-tree") return true;
	return token.startsWith("--git-dir=") || token.startsWith("--work-tree=");
}

/**
 * Whether `command` is a single read-only git invocation, or a reason it is not.
 * Pure and side-effect free. Chaining is not handled here; see
 * {@link checkReadOnlyGit}.
 */
function checkSingleGitCommand(command: string, phrasing: ModePhrasing): GitCheck {
	// A quoted parenthesis is no attempted injection: name it, and how to write it without.
	const meta = SHELL_META.exec(command)?.[0] ?? (hasShellEscape(command) ? "\\" : undefined);
	if (meta !== undefined) {
		const what = META_NAME[meta] ?? `a \`${meta}\``;
		return {
			ok: false,
			reason: `${what} is refused even inside quotes ${phrasing.whileDoing}, because this guard reads no quoting — write the argument without it.`,
		};
	}

	const argv = command.split(/\s+/).map(unquote);
	if (argv[0] === "cd") {
		return {
			ok: false,
			reason: `"cd" does not run ${phrasing.whileDoing}; the working directory is already the project root.`,
			hint: TREE_FORMS,
		};
	}
	if (argv[0] !== "git") {
		return {
			ok: false,
			reason: `only read-only git commands run in the shell ${phrasing.whileDoing} (got "${argv[0]}").`,
		};
	}
	if (argv[1] === "--version") return { ok: true };
	if (argv[1] === undefined) {
		return { ok: false, reason: "name a read-only git subcommand." };
	}
	// One judgement for the global slot: what is not a read-only subcommand is refused, and
	// `-c`, `-O`, `--bare` and the retargeting options are all refused here because none of
	// them names one. The forms that move the process or the repository — `-C`, `--git-dir`,
	// `--work-tree` — are the ones given the alternatives their reason named none of.
	if (!READ_ONLY_SUBCOMMANDS.has(argv[1])) {
		return {
			ok: false,
			reason: `"git ${argv[1]}" is not a read-only subcommand.`,
			...(retargetsTree(argv[1]) ? { hint: TREE_FORMS } : {}),
		};
	}

	for (const token of argv.slice(2)) {
		if (isDangerousOption(token)) {
			return { ok: false, reason: `"${token}" is not allowed ${phrasing.whileDoing}.` };
		}
	}

	return checkRest(argv[1], argv.slice(2), phrasing);
}

/** Chain operators that join read-only git commands into one call. */
const CHAIN_SEPARATOR = /(&&|;)/;

/** The switches that keep a repository's own program out of a diff, and where they go. */
const FORCED_DIFF_FLAGS = ["--no-textconv", "--no-ext-diff"] as const;

/** Subcommands that run a diff, and therefore whatever the repository configured for one. */
const DIFF_SUBCOMMANDS = new Set(["diff", "log", "show", "diff-tree", "diff-index", "diff-files", "whatchanged"]);

/** A segment's `git <subcommand>` head, with the whitespace the caller wrote. */
const GIT_HEAD = /^(\s*git\s+)([A-Za-z][A-Za-z-]*)(?=\s|$)/;

/** `git stash show`, which runs a diff under a second word. */
const STASH_SHOW_HEAD = /^(\s*git\s+stash\s+show)(?=\s|$)/;

/**
 * One segment with the diff switches forced in.
 *
 * Spliced into the string rather than rebuilt from tokens, so a quoted argument keeps its
 * quotes and the caller's spacing is untouched — the tokens were only ever unquoted for
 * checking. A subcommand that runs no diff is returned exactly as written, and a switch the
 * segment already carries is not added twice, so the result is its own fixed point.
 *
 * The check is per token, not per substring: a value that happens to contain a switch's text
 * is not the switch, and `--no-textconv` alone still needs `--no-ext-diff` beside it.
 */
function forceNoRepoPrograms(segment: string): string {
	const head = GIT_HEAD.exec(segment);
	if (head === null) return segment;
	const subcommand = head[2] ?? "";
	const at = subcommand === "stash" ? (STASH_SHOW_HEAD.exec(segment)?.[0].length ?? -1) : head[0].length;
	if (at < 0) return segment;
	if (subcommand !== "stash" && !DIFF_SUBCOMMANDS.has(subcommand)) return segment;
	const carried = new Set(segment.split(/\s+/));
	const missing = FORCED_DIFF_FLAGS.filter((flag) => !carried.has(flag));
	if (missing.length === 0) return segment;
	return `${segment.slice(0, at)} ${missing.join(" ")}${segment.slice(at)}`;
}

/**
 * Whether `command` is one or more read-only git invocations joined by `&&` or
 * `;`, and — when it is — the command to run, with the switches that stop a
 * repository's own diff program forced in.
 *
 * Every segment is validated independently, so a chain can only combine allowed
 * reads. Pipes, substitution, redirection, and a conditional `||` stay blocked.
 * The returned command is what `index.ts` puts on the call, so the guard decides
 * both the shape and the switches rather than leaving the latter to the model.
 */
export function readOnlyGitCommand(input: string, phrasing: ModePhrasing): GitCommandVerdict {
	const command = input.trim();
	if (command === "") return { ok: false, reason: "the command is empty." };

	const parts = command.split(CHAIN_SEPARATOR);
	const rewritten: string[] = [];
	for (const [index, part] of parts.entries()) {
		// Odd entries are the separators themselves, which are kept as written.
		if (index % 2 === 1) {
			rewritten.push(part);
			continue;
		}
		const segment = part.trim();
		if (segment === "") {
			return { ok: false, reason: "a chained command has an empty segment." };
		}
		const verdict = checkSingleGitCommand(segment, phrasing);
		if (!verdict.ok) return verdict;
		rewritten.push(forceNoRepoPrograms(part));
	}
	return { ok: true, command: rewritten.join("") };
}

/**
 * Judge a `bash` call as read-only git, or say why it may not run.
 *
 * The three steps a guard takes are here rather than in each handler: refuse a command that is
 * not a non-empty string, judge it with {@link readOnlyGitCommand}, and write the approved
 * command back onto the call — the guard decides both the shape and the switches, so the call
 * runs what it approved rather than what the model wrote. Plan mode and the board's write gate
 * are the two callers, and the sentence comes back with neither a mode prefix nor a guidance
 * clause: what a refusal is called, and where it sends the caller next, are the caller's own.
 *
 * `undefined` is the ordinary answer, and it means the call may run as it now stands.
 */
export function readOnlyBashRefusal(input: unknown, phrasing: ModePhrasing, guidance: string): string | undefined {
	const command = (input as { command?: unknown } | undefined)?.command;
	if (typeof command !== "string" || command.trim() === "") {
		return `an empty bash command is not allowed. ${guidance}`;
	}
	const decision = readOnlyGitCommand(command, phrasing);
	if (!decision.ok) return `${decision.reason} ${guidance}`;
	(input as { command: string }).command = decision.command;
	return undefined;
}
