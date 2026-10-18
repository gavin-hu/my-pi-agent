/**
 * The isolation gaps a worktree session carries, as data (pure).
 *
 * Re-rooting is not the same as isolating: Pi has no mutable session cwd, so a
 * shell the user runs directly still runs in the main checkout; a command whose
 * git behavior cannot be verified passes the guard unless
 * `blockUnparsableCommands` is set; and the Windows `powershell` tool has no
 * worktree surface, so the guard refuses it unless `blockPowershell` is off.
 * The README documents all three, which is no help mid-task, so the session
 * names them where the user already looks: `/worktree` status, and `doctor`.
 *
 * Only the unverifiable-command gap carries a count. A `!` shell or a
 * `powershell` call is visible in the transcript; a command the guard let
 * through unverified is otherwise silent, so `index.ts` counts those per
 * session and this module says how many ran.
 */

import type { WorktreeConfig } from "./config.ts";

/** One surface isolation does not cover. */
export interface IsolationGap {
	/** Short label for the surface, e.g. `! shell`. */
	surface: string;
	/** What is not isolated, and why. */
	detail: string;
}

/** The session facts the gap rules read. */
export interface GapInput {
	/** `process.platform`; `powershell` only exists on Windows. */
	platform: string;
	/** Tool names active in this session, to tell whether `powershell` is offered. */
	activeTools: readonly string[];
	config: WorktreeConfig;
	/** Commands this session let through although their git behavior could not be verified. */
	unverifiableCommands: number;
}

/** The gaps a session carries, in the order a reader should meet them. */
export function isolationGaps(input: GapInput): IsolationGap[] {
	const gaps: IsolationGap[] = [
		{
			surface: "! shell",
			detail: "runs in the main checkout; Pi has no mutable session cwd",
		},
	];
	// Only while the guard lets the tool through: refusing it closes the gap, and a
	// switch that reopens it is exactly what this row is for.
	if (input.platform === "win32" && input.activeTools.includes("powershell") && !input.config.guard.blockPowershell) {
		gaps.push({
			surface: "powershell",
			detail: "allowed by worktree.guard.blockPowershell: false; not re-rooted or guarded",
		});
	}
	if (!input.config.guard.blockUnparsableCommands) {
		const ran = input.unverifiableCommands > 0 ? `; ${input.unverifiableCommands} ran this session` : "";
		gaps.push({
			surface: "unverifiable",
			detail: `$(...), backticks, eval, and sh -c pass through (blockUnparsableCommands is off)${ran}`,
		});
	}
	return gaps;
}

/**
 * The rendered `Not isolated:` block: one indented line per gap, labels padded
 * to the longest one. No gaps, no lines — a section that says nothing should
 * not be printed.
 */
export function gapLines(gaps: readonly IsolationGap[]): string[] {
	if (gaps.length === 0) return [];
	const column = Math.max(...gaps.map((gap) => gap.surface.length));
	return gaps.map((gap) => `  ${gap.surface.padEnd(column)}  ${gap.detail}`);
}
