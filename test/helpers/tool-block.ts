/**
 * A tool drawn through bytefly's frame, for the two root contracts that read it.
 *
 * `tool-render.test.ts` proves the shape every row shares and `tool-rows.test.ts` holds the
 * height a collapsed block is allowed, so both draw the same call and the same result through
 * the same frame. The extension list, the render context, the height table, and the width set
 * are the things a second copy drifts on first, so they live here: `shared-helpers.test.ts`
 * fails a body two suites carry, and this is the answer to it rather than a way around it.
 *
 * Registration only — no session hook runs here, so no store, state, or network is touched.
 * Nothing in this module holds module-level state; every function builds what it returns.
 */

import { expect } from "bun:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import board from "../../extensions/board/index.ts";
import bytefly from "../../extensions/bytefly/index.ts";
import codeReview from "../../extensions/code-review/index.ts";
import fileRead from "../../extensions/file-read/index.ts";
import goal from "../../extensions/goal/index.ts";
import jobs from "../../extensions/job/index.ts";
import memory from "../../extensions/memory/index.ts";
import planMode from "../../extensions/plan/index.ts";
import question from "../../extensions/question/index.ts";
import sessionBus from "../../extensions/session-bus/index.ts";
import subagent from "../../extensions/subagent/index.ts";
import team from "../../extensions/team/index.ts";
import todo from "../../extensions/todo/index.ts";
import watch from "../../extensions/watch/index.ts";
import webAccess from "../../extensions/web-access/index.ts";
import wechat from "../../extensions/wechat/index.ts";
import { registerTools as registerWorktreeTools } from "../../extensions/worktree/tools.ts";
import { createFakePi } from "./fakes.ts";

/** Every extension that registers a tool with a renderer, as the gallery does. */
export const EXTENSIONS: Array<(pi: any) => void> = [
	bytefly,
	fileRead,
	codeReview,
	goal,
	jobs,
	memory,
	planMode,
	question,
	sessionBus,
	subagent,
	todo,
	watch,
	webAccess,
	wechat,
	board,
	team,
	// The tool's renderers only: the extension's root-tool wrappers shadow `edit`/`write`/`bash`
	// for an isolated session, and these suites draw tool blocks rather than a session.
	(pi: any) => registerWorktreeTools(pi),
];

/** The widths the transcript is exercised at: wide, split, and narrow. */
export const WIDTHS = [80, 48, 40];

/** The viewport the height budget is measured at: Pi's transcript width on a settled terminal. */
export const BUDGET_WIDTH = 80;

/** Control characters that must never reach the terminal; SGR may. */
const RAW_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** A render context with the fields the package renderers read. */
export function toolBlockContext(overrides: Record<string, unknown> = {}): any {
	return {
		args: {},
		toolCallId: "call-contract",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/home/u/repo/project",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		durationMs: undefined,
		outputPad: 0,
		...overrides,
	};
}

/** The frame and the tools, registered once for the cases that draw through the frame. */
export function blockHarness(): { frame: any; tools: Map<string, any> } {
	const fake = createFakePi();
	for (const extension of EXTENSIONS) extension(fake.pi);
	const frame: any = fake.toolRenderers[0];
	expect(frame, "bytefly registered no tool frame").toBeDefined();
	return { frame, tools: fake.tools };
}

/** Every tool the package's extensions register. */
export function registeredTools(): Map<string, any> {
	const fake = createFakePi();
	for (const extension of EXTENSIONS) extension(fake.pi);
	return fake.tools;
}

/** Assert every line fits the width and carries no raw control characters. */
export function expectBlockBounded(lines: string[], width: number, label: string): void {
	for (const line of lines) {
		expect(visibleWidth(line), `${label} exceeds ${width}`).toBeLessThanOrEqual(width);
		expect(stripTerminalSequences(line), `${label} carries a control character`).not.toMatch(RAW_CONTROL);
	}
}

/**
 * The height each package fixture's collapsed block is allowed, in rows, at 80 columns.
 *
 * A number here is a ceiling, and the table is a ratchet: each one is what the block
 * drew when the budget landed, a trim lowers it, and an entry may only fall. Raising
 * one is a deliberate edit that states its reason beside the number — never an
 * adjustment to get green, which is how a transcript grows a row per release in
 * silence. `LONG_SUITES` in `suite-sizes.test.ts` holds the same shape for a suite's
 * lines, and `LONG_MODULES` for a module's.
 *
 * Package fixtures only. The builtin fixtures are Pi's own renderers, so a ceiling over
 * them would pin the host's release cadence, and the eight expanded fixtures are the
 * gallery's `ctrl+o` variants rather than the block a session shows.
 *
 * Six entries reach the transcript through bytefly's generic fallback — the four
 * `worktree` blocks, `open_path`, and `subagent-background` — which is why the frame
 * resolves each fixture's tool instead of reading `fake.tools` alone: those six are the
 * blocks no registered renderer shapes.
 */
export const COLLAPSED_ROWS: Record<string, number> = {
	board: 2,
	"board-archived": 2,
	"board-contract": 2,
	// 4 -> 2: a refusal draws its verdict and folds the route behind the expand hint; the
	// instruction is still in the result, which is where the model reads it.
	"board-gated": 2,
	"board-refused": 2,
	// 3 for the tally: a rounded read's line carries the asks it used to hide behind an owner count,
	// and a board with four of them folds to two lines at 80. The block is still the line — the
	// second row is the reason a lead reads it at all.
	"board-round-line": 3,
	// 2 -> 1 for an active goal: the call line names the objective and the widget above the
	// editor carries the status. A finished or re-planned goal still draws its word, because the
	// widget may be set to hide an achieved one and scrollback is then the only record.
	goal: 1,
	job: 3,
	// 3 -> 2: the confirmation line stays, the `Now 2 project, 1 global.` stat goes -- the next
	// `list` is where a count is read.
	memory: 2,
	"memory-long-subject": 2,
	open_path: 2,
	// 2 -> 1: entering plan mode is the session status line's fact, and the call line already
	// names the verb. The refusals that state something new ("No UI to confirm") still draw.
	plan: 1,
	"plan-cancel": 2,
	// 13 -> 3: the review screen has just drawn the plan, so the block states the count and the
	// path, and the body is one expand away -- the heading carries that affordance.
	"plan-exit": 3,
	"plan-steps": 2,
	"plan-steps-batch": 2,
	"plan-write": 2,
	question: 5,
	"question-cancelled": 3,
	// No renderer: the call line and the result's one sentence, which is the address a
	// person opens and the size of what is behind it. Both actions draw the same 4 rows.
	"code_review-comments": 4,
	"code_review-open": 4,
	read_doc: 2,
	"read_doc-running": 2,
	run_doctor: 2,
	send_wechat: 2,
	"send_wechat-file": 2,
	"send_wechat-running": 2,
	session: 2,
	"session-name": 2,
	// 13 -> 10, not the 11 a plan can promise beforehand: the block drew three blank rows --
	// after the header, between two tasks, and above the totals -- and the section rule and the
	// rail already separate those groups. The metrics row carries the expand hint beside it.
	subagent: 10,
	"subagent-background": 3,
	team: 2,
	"team-assigning": 2,
	// 5 -> 2: the widget above the editor carries the list, so the block states only where the
	// work stands. The rail is what expanding draws.
	todo: 2,
	watch: 3,
	web_fetch: 2,
	"web_fetch-rejected": 2,
	web_search: 7,
	// Nine rows across the four actions became seven when the tool grew a renderer (#742): the
	// block draws the facts it read instead of the sentence written for the model. `prune` is the
	// one entry that went up, 2 -> 3: the fallback's single sentence named no path, and a prune
	// that cannot say which worktrees went is the block a person has to expand to read.
	worktree: 2,
	"worktree-exit": 2,
	"worktree-list": 4,
	"worktree-prune": 3,
};
