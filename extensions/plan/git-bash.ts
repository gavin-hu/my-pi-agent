/**
 * Read-only git shell guard for plan mode (pure).
 *
 * Plan mode keeps the path-taking readers but, historically, disabled raw shell
 * entirely and relied on a structured `git` tool for repository inspection.
 * With that tool removed, this guard lets `bash` run read-only git commands
 * while planning (`powershell` is blocked outright). Several may be chained
 * with `&&` or `;`, but every segment must itself be a read-only git command.
 *
 * It is deliberately conservative and allowlist-based:
 *
 *   1. `&&`/`;` split the command into segments; each segment must contain no
 *      other shell metacharacters (no pipes, substitution, or redirection). A
 *      backslash before an ordinary character is a literal separator, so a
 *      Windows path (`git diff -- extensions\plan`) survives, while a backslash
 *      that escapes whitespace, a quote, another backslash, or a metacharacter
 *      is still refused;
 *   2. each segment must start with `git` and name a read-only subcommand;
 *   3. options that can execute an external program or write a file are
 *      rejected, and dual-use subcommands (`branch`, `tag`, `remote`, `config`,
 *      `stash`, `worktree`, `reflog`) must be in their read-only form.
 *
 * This is a guard rail, not a sandbox — the same stance as the rest of plan
 * mode. A few exotic read invocations are refused on purpose rather than
 * risking a bypass. It touches nothing on disk.
 */

/** Verdict from the read-only git command guard. */
export type GitCommandVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Characters that chain commands, substitute, redirect, or form a subshell.
 * `&&`/`;` are handled as segment separators before this runs; any remaining
 * occurrence blocks (including inside quotes — a deliberate over-rejection).
 */
const SHELL_META = /[;&|<>`$(){}[\]\n\r]/;

/**
 * A backslash that escapes something: whitespace, a quote, another backslash, a
 * shell metacharacter, or the end of the command. A backslash before any other
 * character is a literal separator, so a Windows path (`C:\Users\x`) survives
 * the check. Pure and side-effect free.
 */
const SHELL_ESCAPE = /\\(?=$|[\s"'\\;&|<>`$(){}[\]])/;

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

const DANGEROUS_EXACT = new Set(["-c", "-O", "--bare", "--ext-diff", "--textconv"]);

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

function checkFlagAndPositional(rest: string[], spec: RestCheck, label: string): GitCommandVerdict {
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

/** Subcommand-specific read-only rules; the rest only pass the option denylist. */
function checkRest(subcommand: string, rest: string[]): GitCommandVerdict {
	switch (subcommand) {
		case "branch":
			return checkFlagAndPositional(rest, { flags: BRANCH_FLAGS, listFlags: ["-l", "--list"] }, "branch");
		case "tag":
			return checkFlagAndPositional(rest, { flags: TAG_FLAGS, listFlags: ["-l", "--list"] }, "tag");
		case "remote": {
			const [first] = rest.map(unquote);
			if (rest.length === 0) return { ok: true };
			if ((first === "-v" || first === "--verbose") && rest.length === 1) return { ok: true };
			if (first === "show" || first === "get-url") return { ok: true };
			return {
				ok: false,
				reason: `"git remote ${first}" can change a remote; use "git remote -v" or "git remote show".`,
			};
		}
		case "config": {
			const hasReadFlag = rest.some((raw) => {
				const token = unquote(raw);
				return (
					token.startsWith("--get") ||
					token === "--list" ||
					token === "-l" ||
					token === "--show-origin" ||
					token === "--show-scope"
				);
			});
			if (!hasReadFlag) {
				return { ok: false, reason: '"git config" may only read; add --get, --get-all, --get-regexp, or --list.' };
			}
			return { ok: true };
		}
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
		default:
			return { ok: true };
	}
}

/**
 * Whether `command` is a single read-only git invocation, or a reason it is not.
 * Pure and side-effect free. Chaining is not handled here; see
 * {@link checkReadOnlyGit}.
 */
function checkSingleGitCommand(command: string): GitCommandVerdict {
	if (SHELL_META.test(command) || SHELL_ESCAPE.test(command)) {
		return { ok: false, reason: "shell substitution and redirection are not allowed while planning." };
	}

	const argv = command.split(/\s+/).map(unquote);
	if (argv[0] === "cd") {
		return {
			ok: false,
			reason: '"cd" does not run while planning; the working directory is already the project root.',
		};
	}
	if (argv[0] !== "git") {
		return { ok: false, reason: `only read-only git commands run in the shell while planning (got "${argv[0]}").` };
	}
	if (argv[1] === "--version") return { ok: true };
	if (argv[1] === undefined) {
		return { ok: false, reason: "name a read-only git subcommand." };
	}
	if (isDangerousOption(argv[1])) {
		return { ok: false, reason: `"git ${argv[1]}" is not a read-only subcommand.` };
	}
	if (!READ_ONLY_SUBCOMMANDS.has(argv[1])) {
		return { ok: false, reason: `"git ${argv[1]}" is not a read-only subcommand.` };
	}

	for (const token of argv.slice(1)) {
		if (isDangerousOption(token)) {
			return { ok: false, reason: `"${token}" is not allowed while planning.` };
		}
	}

	return checkRest(argv[1], argv.slice(2));
}

/** Chain operators that join read-only git commands into one call. */
const CHAIN_SEPARATOR = /(?:&&|;)/;

/**
 * Whether `command` is one or more read-only git invocations joined by `&&` or
 * `;`, or a reason it is not. Every segment is validated independently, so a
 * chain can only combine allowed reads. Pipes, substitution, redirection, and
 * a conditional `||` stay blocked. Pure and side-effect free.
 */
export function checkReadOnlyGit(input: string): GitCommandVerdict {
	const command = input.trim();
	if (command === "") return { ok: false, reason: "the command is empty." };

	for (const raw of command.split(CHAIN_SEPARATOR)) {
		const segment = raw.trim();
		if (segment === "") {
			return { ok: false, reason: "a chained command has an empty segment." };
		}
		const verdict = checkSingleGitCommand(segment);
		if (!verdict.ok) return verdict;
	}
	return { ok: true };
}
