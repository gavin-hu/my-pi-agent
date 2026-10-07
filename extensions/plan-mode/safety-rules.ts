/**
 * Read-only rule tables for plan mode (data only).
 *
 * The assessment logic lives in `safety.ts`; keeping the tables separate makes
 * them easy to review and extend without touching the parser.
 */

/** First words allowed in plan mode. */
export const ALLOWED = new Set([
	"cat",
	"head",
	"tail",
	"less",
	"more",
	"grep",
	"rg",
	"find",
	"fd",
	"ls",
	"pwd",
	"echo",
	"printf",
	"wc",
	"sort",
	"uniq",
	"comm",
	"cut",
	"tr",
	"column",
	"diff",
	"file",
	"stat",
	"du",
	"df",
	"tree",
	"basename",
	"dirname",
	"realpath",
	"readlink",
	"which",
	"whereis",
	"type",
	"printenv",
	"uname",
	"hostname",
	"whoami",
	"id",
	"date",
	"cal",
	"uptime",
	"ps",
	"top",
	"htop",
	"free",
	"nproc",
	"jq",
	"sed",
	"xxd",
	"od",
	"strings",
	"hexdump",
	"md5sum",
	"shasum",
	"sha256sum",
	"git",
	"npm",
	"yarn",
	"pnpm",
	"bun",
	"node",
	"python",
	"python3",
	"curl",
	"wget",
	"test",
]);

/** Read-only git subcommands. */
export const GIT_READ = new Set([
	"status",
	"log",
	"diff",
	"show",
	"branch",
	"remote",
	"config",
	"ls-files",
	"ls-tree",
	"ls-remote",
	"describe",
	"rev-parse",
	"rev-list",
	"show-ref",
	"symbolic-ref",
	"for-each-ref",
	"cat-file",
	"grep",
	"blame",
	"shortlog",
	"whatchanged",
	"diff-tree",
	"diff-files",
	"diff-index",
	"name-rev",
	"count-objects",
	"check-ignore",
	"worktree",
]);

/** Flags that make `git config` a read. */
export const GIT_CONFIG_READ = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin"]);

/** `git branch` flags that take a value; any other positional names a branch to mutate. */
export const BRANCH_LIST_FLAGS = new Set([
	"-l",
	"--list",
	"--contains",
	"--no-contains",
	"--merged",
	"--no-merged",
	"--points-at",
	"--format",
	"--sort",
	"-t",
	"--track",
]);

/** Read-only subcommands per package manager. */
export const PACKAGE_READ: Record<string, Set<string>> = {
	npm: new Set(["list", "ls", "view", "info", "search", "outdated", "audit", "explain", "why", "ping", "root", "bin", "prefix"]),
	yarn: new Set(["list", "info", "why", "audit", "versions"]),
	pnpm: new Set(["list", "ls", "why", "audit", "outdated", "licenses", "root"]),
	bun: new Set(["pm"]),
};

/** Interpreters only allowed to print their version. */
export const VERSION_ONLY = new Set(["node", "python", "python3"]);

export interface DenyRule {
	pattern: RegExp;
	reason: string;
}

/**
 * Shell-level constructs. These are evaluated against the command with
 * single-quoted spans removed, because the shell treats single quotes
 * literally (no expansion), while double quotes and unquoted text are live.
 */
export const SHELL_DENY: DenyRule[] = [
	{ pattern: /\$\(|`/, reason: "command substitution is not allowed" },
	{ pattern: /[<>]\(/, reason: "process substitution is not allowed" },
];

/**
 * Per-command argument rules, matched against the command's own segment (with
 * quotes intact, since tools like `sed` parse their quoted scripts). Scoping
 * by command avoids rejecting harmless text such as `grep 'sed -i' file`.
 */
export const COMMAND_ARG_DENY: Record<string, DenyRule[]> = {
	find: [{ pattern: /\s-(exec|execdir|ok|okdir|delete|fprint|fprint0|fls)\b/, reason: "find may not execute or delete" }],
	sed: [
		{ pattern: /\s(?:-i|--in-place)\b/, reason: "in-place editing is not allowed" },
		{ pattern: /['"]\s*w\s+[^\s;'"]/, reason: "sed may not write a file" },
		{ pattern: /\bs\/[^/;]*\/[^/;]*\/[a-z]*w[a-z]*\s+[^\s;'"]/, reason: "sed may not write a file" },
	],
	sort: [{ pattern: /\s(?:-o|--output)\b/, reason: "sort may not write a file" }],
	tree: [{ pattern: /\s-o\b/, reason: "tree may not write a file" }],
	date: [{ pattern: /\s(?:-s|--set)\b/, reason: "the clock may not be set" }],
	curl: [
		{ pattern: /\s-[a-zA-Z]*[oO]\b/, reason: "curl may not write a file" },
		{ pattern: /\s--(?:output|remote-name)\b/, reason: "curl may not write a file" },
		{ pattern: /\s(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data\S*|-d\b|-F\b|-T\b|--upload-file)/i, reason: "curl may not mutate remote state" },
	],
	wget: [{ pattern: /\s(?:--post-data|--post-file|--method)/i, reason: "wget may not mutate remote state" }],
};
