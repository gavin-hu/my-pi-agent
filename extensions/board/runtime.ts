/**
 * Lead mode: the session that serves the board's page holds the seat, not the code.
 *
 * The mode is one value on the branch, shared with plan mode (`lib/mode-state.ts`):
 * `/board` turns it on when the page started under this session's own seat, and
 * `/board exit` turns it off. Turning it off is the process's answer as well as the
 * branch's: `disable` latches the exit for the session id, and `reconcile` never
 * re-arms over that latch, so an off-switch that said it worked cannot be undone by
 * a branch write that did not land. While it is on, the tool set is narrowed to the
 * coordination surface — the board, the team, the session bus, the trackers, the
 * readers, `bash` for read-only git, and a `subagent` pinned read-only — and every
 * other call is refused by a sentence that names the hatch. The gate denies by
 * default over that allow-list, so a tool nobody anticipated is refused rather than
 * run — and unlike plan mode the list is closed: the policy is built without an
 * annotation lookup, because `readOnlyHint` is self-declared by the extension or the
 * MCP server, and a permission decision cannot rest on the subject's own testimony
 * about itself. Plan mode keeps that door, because it is a read-only *tool* gate
 * while this is a role admission.
 *
 * This is a guard rail, not a sandbox: the seat stops accidents and keeps the
 * session's attention on the round, and the card's own gates — a sign needs the
 * lead, a claim refuses a held path, `done` needs a merge — carry the enforcement.
 *
 * The runtime is loaded with `import()` by the extension, so a session that never
 * serves a page pays nothing for it; `restore` runs on the first turn of a session
 * whose branch already says `lead`, which is why a `/resume` re-applies the seat
 * without registration importing any of this.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ModePhrasing, readOnlyGitCommand } from "../../lib/git/read-command.ts";
import { modeRefusal } from "../../lib/mode-entry.ts";
import { LEAD_MODE_ENTRY_TYPE, lastModeState } from "../../lib/mode-state.ts";
import {
	createReadOnlyPolicy,
	type ReadOnlyPolicy,
	supportsReadOnlyDelegation,
	WORKSPACE_READERS,
} from "../../lib/policy.ts";
import {
	BOARD_TOOL,
	GOAL_TOOL,
	PLAN_TOOL,
	QUESTION_TOOL,
	RUN_DOCTOR_TOOL,
	SESSION_TOOL,
	SUBAGENT_READ_ONLY_PARAM,
	SUBAGENT_TOOL,
	TEAM_TOOL,
	TODO_TOOL,
	WEB_FETCH_TOOL,
	WEB_SEARCH_TOOL,
} from "../../lib/tool-names.ts";
import { createToolSetFilter } from "../../lib/tool-set.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/tui/glyphs.ts";

/** How the seat words a read-only git refusal, so the guard itself stays neutral. */
export const LEAD_PHRASING: ModePhrasing = { label: "lead mode", whileDoing: "in lead mode" };

/**
 * What the seat may call: the coordination surface and the readers, `bash` for the
 * git guard to judge, and the `plan` tool because a card's plan file is written by
 * its `write` action. Nothing else is on the list, so nothing else is allowed.
 */
export const LEAD_ALLOWED_TOOLS = [
	...WORKSPACE_READERS,
	TODO_TOOL,
	GOAL_TOOL,
	QUESTION_TOOL,
	BOARD_TOOL,
	TEAM_TOOL,
	SESSION_TOOL,
	RUN_DOCTOR_TOOL,
	PLAN_TOOL,
	SUBAGENT_TOOL,
	WEB_SEARCH_TOOL,
	WEB_FETCH_TOOL,
	"bash",
] as const;

/** The one tool the seat keeps active in both modes: its own plan file's writer. */
const MODE_TOOLS = [PLAN_TOOL];

/** What a refusal adds when the tool name alone does not say where to go next. */
export const LEAD_GUIDANCE = "`/board exit` gives every tool back; the page keeps serving.";

/** What the runtime exposes: the mode's state, its gate, and its one sentence. */
export interface LeadRuntime {
	/** Whether the seat is held right now. */
	isEnabled(): boolean;
	/** Take the seat: narrow the tool set, publish the chip, record it on the branch. */
	enable(ctx: ExtensionContext): void;
	/**
	 * Leave the seat: put the tool set back, clear the chip, record it on the branch, and latch the
	 * exit for this session, so no reconcile re-arms over it.
	 */
	disable(ctx: ExtensionContext): void;
	/**
	 * Adopt what the branch and the page say together: the door every turn, `/tree`, `/resume` and
	 * the page's own close asks, so the mode cannot outlive either half.
	 */
	reconcile(ctx: ExtensionContext, serving: boolean): void;
	/** Why a call is refused while holding the seat, or undefined when it may proceed. */
	refusal(toolName: string, input: unknown): Promise<string | undefined>;
}

export function createLeadRuntime(pi: ExtensionAPI): LeadRuntime {
	const policy: ReadOnlyPolicy = createReadOnlyPolicy({
		allow: LEAD_ALLOWED_TOOLS,
		guidance: LEAD_GUIDANCE,
	});
	const tools = createToolSetFilter(pi, policy, MODE_TOOLS);
	let enabled = false;
	// Tools this leave has to put back; a branch carries the list it hid, so a resumed
	// seat restores the user's set rather than the mode's own.
	let removed: string[] = [];
	/**
	 * The session whose `/board exit` latched the seat off.
	 *
	 * The process answers for itself here: a branch write that did not land would otherwise let the
	 * next reconcile re-arm the leash the user just took off. Cleared by `/board` and by a new
	 * session id, so a resumed session asks the branch again.
	 */
	let latchedFor: string | undefined;

	const setStatus = (ctx: ExtensionContext): void => {
		ctx.ui.setStatus(STATUS_KEYS.leadMode, enabled ? `${GLYPHS.lead} lead` : undefined);
	};

	const setEnabled = (next: boolean, ctx: ExtensionContext | undefined, persist: boolean): void => {
		const changed = next !== enabled;
		if (changed && next) removed = tools.capture();
		enabled = next;
		if (next) tools.enter();
		else {
			tools.leave(removed, { reAdd: true });
			removed = [];
		}
		if (persist && changed) {
			pi.appendEntry(
				LEAD_MODE_ENTRY_TYPE,
				(next ? { enabled, removed } : { enabled }) satisfies {
					enabled: boolean;
					removed?: string[];
				},
			);
		}
		if (ctx !== undefined) setStatus(ctx);
	};

	return {
		isEnabled: () => enabled,
		// Taking the seat is the user's move, and it clears the latch: the page is served again.
		enable: (ctx) => {
			latchedFor = undefined;
			setEnabled(true, ctx, true);
		},
		// Leaving it is the user's move too, and the fact this process keeps even when the branch
		// write does not land: `reconcile` asks the latch before it asks the branch.
		disable: (ctx) => {
			latchedFor = ctx.sessionManager.getSessionId();
			setEnabled(false, ctx, true);
		},
		reconcile: (ctx, serving) => {
			const id = ctx.sessionManager.getSessionId();
			// A new session is a new role: the latch was one session's answer to one exit.
			if (latchedFor !== undefined && latchedFor !== id) latchedFor = undefined;
			const branch = lastModeState(ctx.sessionManager.getBranch());
			const next = branch.mode === "lead" && serving && latchedFor !== id;
			if (next === enabled) {
				setStatus(ctx);
				return;
			}
			if (next) {
				removed = [...(branch.removed ?? [])];
				enabled = true;
				tools.enter();
				setStatus(ctx);
				return;
			}
			// The branch decides whether the user's set comes back: a page that ended the seat puts it
			// back, while a branch that moved on leaves it to the host, which has already restored the
			// base set of the branch it landed on — the assumption a restore made, kept.
			const pageEnded = branch.mode === "lead";
			tools.leave(removed, { reAdd: pageEnded });
			removed = [];
			enabled = false;
			// A page that ended the seat is a fact the branch should carry too; a branch that moved on
			// already says its own answer.
			if (pageEnded) {
				pi.appendEntry(LEAD_MODE_ENTRY_TYPE, { enabled: false } satisfies { enabled: boolean; removed?: string[] });
			}
			setStatus(ctx);
		},
		refusal: async (toolName, input) => {
			if (!enabled) return undefined;
			// The one write the seat sanctions: a card's plan file, whose verbs stay with
			// `plan`. Entering the mode itself is not the seat's move — planning strips the
			// contract and the signature the seat exists for.
			if (toolName === PLAN_TOOL) {
				const action = (input as { action?: unknown } | undefined)?.action;
				return action === "enter" ? modeRefusal("lead", "entering plan mode") : undefined;
			}
			// A delegated child is forced read-only in place, the way plan mode pins it, so
			// the model cannot forget the flag; a child that cannot honour it is refused.
			if (toolName === SUBAGENT_TOOL) {
				if (!supportsReadOnlyDelegation(pi)) {
					return modeRefusal("lead", `delegating with a "${SUBAGENT_TOOL}" that cannot run read-only`);
				}
				if (typeof input === "object" && input !== null) {
					(input as Record<string, unknown>)[SUBAGENT_READ_ONLY_PARAM] = true;
				}
				return undefined;
			}
			// `bash` is on the allow-list so this guard can decide: read-only git, rewritten
			// with the switches that keep a repository's own diff program out of it.
			if (toolName === "bash") {
				const command = (input as { command?: unknown } | undefined)?.command;
				if (typeof command !== "string" || command.trim() === "") {
					return modeRefusal("lead", "running an empty shell command");
				}
				const decision = readOnlyGitCommand(command, LEAD_PHRASING);
				if (!decision.ok) return `${decision.reason} ${modeRefusal("lead", "running another command")}`;
				(input as { command: string }).command = decision.command;
				return undefined;
			}
			if (!policy.isAllowed(toolName)) return modeRefusal("lead", `using "${toolName}"`);
			return undefined;
		},
	};
}
