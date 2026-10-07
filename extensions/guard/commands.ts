/**
 * Dangerous-command assessment for the guard extension (pure).
 *
 * Unlike plan mode's read-only allowlist, this is a deny/confirm list over
 * ordinary commands: a command is `safe`, `confirm` (ask the user), or `block`
 * (refuse outright). It is a guard rail, not a sandbox.
 *
 * The check runs on the whole command line: config `allow` regexes first, then
 * structural checks and built-in/config regexes, with `block` outranking
 * `confirm`.
 */

import type { GuardConfig } from "./config.ts";

export type CommandRisk = "safe" | "confirm" | "block";

export interface CommandVerdict {
	risk: CommandRisk;
	reason: string;
}

/** Commands that destroy data or the machine outright. */
const BUILTIN_BLOCK: RegExp[] = [
	/\bdd\b[^|;]*\bof=\/dev\/(?:sd|disk|nvme|hd|mmcblk|vd)/i,
	/>\s*\/dev\/(?:sd|disk|nvme|hd|mmcblk|vd)/i,
	/\bmkfs(?:\.\w+)?\b/i,
	/\bwipefs\b/i,
	/\bshred\b/i,
	// fork bomb
	/:\s*\(\s*\)\s*\{.*\|\s*:\s*&\s*\}\s*;\s*:/,
];

/** Commands that discard work, escalate privilege, or mutate shared state. */
const BUILTIN_CONFIRM: RegExp[] = [
	/\bsudo\b/i,
	/(?:^|[|;&]\s*)su\s/i,
	/\bchmod\b[^|;]*\b777\b/i,
	/\bchown\b[^|;]*\b777\b/i,
	/\b(?:curl|wget)\b[^|;]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/i,
	/\bgit\s+push\b[^|;]*\s(?:-f|--force)\b/i,
	/\bgit\s+reset\s+--hard\b/i,
	/\bgit\s+clean\b[^|;]*\s-[a-z]*f/i,
	/\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\./i,
	/\bfind\b[^|;]*\s-delete\b/i,
	/\bfind\b[^|;]*\s-exec(?:dir)?\b[^|;]*\brm\b/i,
	/\b(?:npm|pnpm|yarn)\s+publish\b/i,
	/\bdocker\s+system\s+prune\b/i,
	/\bkubectl\s+delete\b/i,
	/\bterraform\s+destroy\b/i,
	/\bhistory\s+-c\b/i,
	/(?:^|[|;&]\s*)(?:shutdown|reboot|halt|poweroff)\b/i,
	/\bkill\s+-9\s+-1\b/i,
	/\bchmod\b[^|;]*\s-[a-zA-Z]*R[a-zA-Z]*\b[^|;]*\s\/(?:\s|$)/i,
	/\bchown\b[^|;]*\s-[a-zA-Z]*R[a-zA-Z]*\b[^|;]*\s\/(?:\s|$)/i,
];

const DANGEROUS_TARGETS = new Set(["/", "/*", ".", "..", "~", "~/", "~/*", "$HOME", "${HOME}", "$HOME/*", "${HOME}/*"]);

function safeRegExp(source: string): RegExp | undefined {
	try {
		return new RegExp(source, "i");
	} catch {
		return undefined;
	}
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

function commandTokens(segment: string): { command: string; args: string[] } | undefined {
	const tokens = segment.split(/\s+/);
	let i = 0;
	while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
	const raw = tokens[i];
	if (!raw) return undefined;
	const command = raw.split("/").pop() ?? raw;
	return { command, args: tokens.slice(i + 1) };
}

function hasShortFlag(flags: string[], letter: string): boolean {
	return flags.some((flag) => flag.startsWith("-") && !flag.startsWith("--") && flag.slice(1).includes(letter));
}

function hasLongFlag(flags: string[], name: string): boolean {
	return flags.includes(name);
}

function isDangerousTarget(operand: string): boolean {
	const trimmed = operand.replace(/\/+$/, "") || "/";
	if (DANGEROUS_TARGETS.has(operand) || DANGEROUS_TARGETS.has(trimmed)) return true;
	return /^\/(?:etc|usr|var|bin|sbin|lib|lib64|opt|root|home|boot|dev|sys|proc|System|Library)(?:\/|$)/.test(operand);
}

/** Structural checks that need the command's argument shape, not a regex. */
function structuralVerdict(segment: string): CommandVerdict | undefined {
	const parsed = commandTokens(segment);
	if (!parsed) return undefined;
	const { command, args } = parsed;

	if (command === "rm") {
		const flags = args.filter((arg) => arg.startsWith("-") && arg !== "-");
		const operands = args.filter((arg) => !arg.startsWith("-") || arg === "-");
		const recursive = hasLongFlag(flags, "--recursive") || hasShortFlag(flags, "r") || hasShortFlag(flags, "R");
		const force = hasLongFlag(flags, "--force") || hasShortFlag(flags, "f");
		if (recursive && operands.some(isDangerousTarget)) {
			return { risk: "block", reason: "recursive forced delete of a root or home path" };
		}
		if (recursive) {
			return { risk: "confirm", reason: "recursive delete" };
		}
		if (force && operands.some(isDangerousTarget)) {
			return { risk: "block", reason: "forced delete of a root or home path" };
		}
	}

	if (command === "find" && args.includes("-delete")) {
		return { risk: "confirm", reason: "find -delete" };
	}

	return undefined;
}

function matchesAny(command: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(command));
}

/** Assess a full command line. */
export function analyzeCommand(command: string, config: GuardConfig): CommandVerdict {
	const trimmed = command.trim();
	if (!trimmed) return { risk: "safe", reason: "empty command" };

	const allow = config.commands.allow.map(safeRegExp).filter((re): re is RegExp => !!re);
	if (allow.length > 0 && matchesAny(trimmed, allow)) {
		return { risk: "safe", reason: "allowed by configuration" };
	}

	const block = [
		...(config.commands.includeBuiltins ? BUILTIN_BLOCK : []),
		...config.commands.block.map(safeRegExp).filter((re): re is RegExp => !!re),
	];
	const confirm = [
		...(config.commands.includeBuiltins ? BUILTIN_CONFIRM : []),
		...config.commands.confirm.map(safeRegExp).filter((re): re is RegExp => !!re),
	];

	const segments = splitSegments(trimmed);

	if (config.commands.includeBuiltins) {
		for (const segment of segments) {
			const verdict = structuralVerdict(segment);
			if (verdict?.risk === "block") return verdict;
		}
	}
	if (matchesAny(trimmed, block)) return { risk: "block", reason: "matches a blocked command pattern" };

	if (config.commands.includeBuiltins) {
		for (const segment of segments) {
			const verdict = structuralVerdict(segment);
			if (verdict?.risk === "confirm") return verdict;
		}
	}
	if (matchesAny(trimmed, confirm)) return { risk: "confirm", reason: "matches a command pattern that needs confirmation" };

	return { risk: "safe", reason: "no dangerous pattern matched" };
}
