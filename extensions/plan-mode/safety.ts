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
 */

export interface CommandAssessment {
	safe: boolean;
	/** Why the command was rejected, when `safe` is false. */
	reason?: string;
}

/** First words allowed in plan mode. */
const ALLOWED = new Set([
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
const GIT_READ = new Set([
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
const GIT_CONFIG_READ = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin"]);

/** Read-only subcommands per package manager. */
const PACKAGE_READ: Record<string, Set<string>> = {
	npm: new Set(["list", "ls", "view", "info", "search", "outdated", "audit", "explain", "why", "ping", "root", "bin", "prefix"]),
	yarn: new Set(["list", "info", "why", "audit", "versions"]),
	pnpm: new Set(["list", "ls", "why", "audit", "outdated", "licenses", "root"]),
	bun: new Set(["pm"]),
};

/** Interpreters only allowed to print their version. */
const VERSION_ONLY = new Set(["node", "python", "python3"]);

/** Argument-level escape hatches, checked against the whole command line. */
const DENY_ARGUMENTS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\$\(|`/, reason: "command substitution is not allowed" },
	{ pattern: /\bsudo\b|\bsu\b/, reason: "privilege escalation is not allowed" },
	{ pattern: /\bfind\b[^|;]*\s-(exec|execdir|ok|okdir|delete|fprint|fprint0|fls)\b/, reason: "find may not execute or delete" },
	{ pattern: /\b(?:sed|perl)\b[^|;]*\s(?:-i|--in-place)\b/, reason: "in-place editing is not allowed" },
	{ pattern: /\bsort\b[^|;]*\s(?:-o|--output)\b/, reason: "sort may not write a file" },
	{ pattern: /\btree\b[^|;]*\s-o\b/, reason: "tree may not write a file" },
	{ pattern: /\bdate\b[^|;]*\s(?:-s|--set)\b/, reason: "the clock may not be set" },
	{ pattern: /\bcurl\b[^|;]*\s(?:-X\s*(?:POST|PUT|PATCH|DELETE)|--data\S*|-d\b|-F\b|-T\b|--upload-file)/i, reason: "curl may not mutate remote state" },
	{ pattern: /\bwget\b[^|;]*\s(?:--post-data|--post-file|--method)/i, reason: "wget may not mutate remote state" },
];

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
		if (ch === "&" && command[i + 1] === "&") {
			segments.push(current);
			current = "";
			i++;
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

/** Reason an allowed command's arguments are unsafe, if any. */
function unsafeArguments(command: string, args: string[]): string | undefined {
	if (command === "git") {
		const sub = args[0];
		if (!sub) return undefined;
		if (!GIT_READ.has(sub)) return `"git ${sub}" is not a read-only git command`;
		if (sub === "config" && !args.some((arg) => GIT_CONFIG_READ.has(arg))) {
			return '"git config" is only allowed with a read flag';
		}
		if (sub === "branch" && args.some((arg) => /^-[dDmM]$/.test(arg) || /^--(delete|move)$/.test(arg))) {
			return '"git branch" may not modify branches';
		}
		if (sub === "remote" && args.some((arg) => ["add", "remove", "rm", "set-url", "rename", "set-head", "prune"].includes(arg))) {
			return '"git remote" may not be modified';
		}
		if (sub === "worktree" && args.some((arg) => ["add", "remove", "prune", "move", "repair", "lock", "unlock"].includes(arg))) {
			return '"git worktree" may only be listed';
		}
		return undefined;
	}

	if (command in PACKAGE_READ) {
		const sub = args[0];
		if (!sub) return undefined;
		if (!PACKAGE_READ[command].has(sub)) return `"${command} ${sub}" is not a read-only ${command} command`;
		return undefined;
	}

	if (VERSION_ONLY.has(command)) {
		if (!args.some((arg) => arg === "--version" || arg === "-V")) return `"${command}" is only allowed with --version`;
		return undefined;
	}

	if (command === "find" && args.some((arg) => ["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint"].includes(arg))) {
		return "find may not execute or delete";
	}
	return undefined;
}

/** Assess one segment; returns a rejection reason or undefined. */
function assessSegment(segment: string): string | undefined {
	const tokens = segment.split(/\s+/);
	let i = 0;
	while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
	const command = tokens[i];
	if (!command) return undefined;
	if (!ALLOWED.has(command)) return `"${command}" is not on the read-only allowlist`;
	return unsafeArguments(command, tokens.slice(i + 1));
}

/** Assess a full command line for safe, read-only use in plan mode. */
export function analyzeCommand(command: string): CommandAssessment {
	const trimmed = command.trim();
	if (!trimmed) return { safe: false, reason: "the command is empty" };

	const redirect = findWriteRedirect(trimmed);
	if (redirect) return { safe: false, reason: redirect };

	for (const { pattern, reason } of DENY_ARGUMENTS) {
		if (pattern.test(trimmed)) return { safe: false, reason };
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
