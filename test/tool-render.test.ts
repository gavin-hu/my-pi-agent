/**
 * Cross-cutting render contract: every registered tool draws lines that fit the
 * width it is given, a rejected call renders as a sanitized error, and bytefly's
 * frame reuses the lines it already rendered when nothing changed.
 *
 * The per-tool suites cover each renderer's content. This one proves the shape
 * they all share, because bytefly frames every tool block: a line that overflows
 * its width pushes the rail, an unsanitized message reaches the terminal, and a
 * frame that re-derives every block per render makes a long transcript slow.
 * The result payloads are the gallery's fixtures, so a block is drawn from the
 * result a tool really produces rather than a stand-in built here.
 * Registration only — no session hook runs, so no session state, store, or
 * network is touched.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { ToolCallText } from "../lib/tui/tool.ts";
import board from "../extensions/board/index.ts";
import bytefly from "../extensions/bytefly/index.ts";
import fileRead from "../extensions/file-read/index.ts";
import goal from "../extensions/goal/index.ts";
import jobs from "../extensions/job/index.ts";
import memory from "../extensions/memory/index.ts";
import planMode from "../extensions/plan/index.ts";
import question from "../extensions/question/index.ts";
import sessionBus from "../extensions/session-bus/index.ts";
import team from "../extensions/team/index.ts";
import subagent from "../extensions/subagent/index.ts";
import todo from "../extensions/todo/index.ts";
import watch from "../extensions/watch/index.ts";
import webAccess from "../extensions/web-access/index.ts";
import wechat from "../extensions/wechat/index.ts";
import { registerTools as registerWorktreeTools } from "../extensions/worktree/tools.ts";
import { FIXTURES, type ToolFixture } from "../scripts/tools/fixtures/index.ts";
import { fixtureState } from "../scripts/tools/fixtures/state.ts";
import { createFakePi, fakeTheme } from "./helpers/fakes.ts";
import { ALL_EXTENSIONS_ENV, useEnv } from "./helpers/env.ts";

/** Every tool here is rendered, so the fake session loads the whole pack. */
const env = useEnv(ALL_EXTENSIONS_ENV);

/**
 * The process theme an expanded subagent block draws with: it renders Pi's
 * Markdown, which reads the theme a session initializes and no renderer can be
 * handed. A width assertion strips the colour, so the system palette is enough.
 */
initTheme();

afterAll(() => env.restore());

/** Every extension that registers a tool with a renderer, as the gallery does. */
const EXTENSIONS: Array<(pi: any) => void> = [
	bytefly,
	fileRead,
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
	// for an isolated session, and this suite draws tool blocks rather than a session.
	(pi: any) => registerWorktreeTools(pi),
];

/** The widths the transcript is exercised at: wide, split, and narrow. */
const WIDTHS = [80, 48, 40];

/**
 * The call and result states a row actually renders: arguments still streaming
 * in, a settled call, a collapsed or expanded result, and a partial result.
 */
const CALL_STATES = [
	{ argsComplete: false, isPartial: true },
	{ argsComplete: true, isPartial: false },
];

const RESULT_STATES = [
	{ expanded: false, isPartial: false },
	{ expanded: true, isPartial: false },
	{ expanded: false, isPartial: true },
];

/** Control characters that must never reach the terminal; SGR may. */
const RAW_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** A render context with the fields the package renderers read. */
function context(overrides: Record<string, unknown> = {}): any {
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

/** Every tool the package's extensions register. */
function registeredTools(): Map<string, any> {
	const fake = createFakePi();
	for (const extension of EXTENSIONS) extension(fake.pi);
	return fake.tools;
}

/** Assert every line fits the width and carries no raw control characters. */
function expectBounded(lines: string[], width: number, label: string): void {
	for (const line of lines) {
		expect(visibleWidth(line), `${label} exceeds ${width}`).toBeLessThanOrEqual(width);
		expect(stripTerminalSequences(line), `${label} carries a control character`).not.toMatch(RAW_CONTROL);
	}
}

describe("tool render contract", () => {
	test("every renderCall draws bounded, control-free lines", () => {
		for (const [name, tool] of registeredTools()) {
			if (typeof tool.renderCall !== "function") continue;
			for (const width of WIDTHS) {
				const component = tool.renderCall({}, fakeTheme, context());
				expect(component, `${name} renderCall returned nothing`).toBeDefined();
				const lines = component.render(width);
				if (component instanceof ToolCallText) {
					expect(lines, `${name} call wrapped at ${width}`).toHaveLength(component.text.split("\n").length);
				}
				expectBounded(lines, width, `${name} call at ${width}`);
			}
		}
	});

	/**
	 * One fixture's result as the transcript draws it: the same payload, with the
	 * collapse lifted for the expanded pass so the rows and the `N more` hint a
	 * collapsed block hides are drawn too.
	 */
	function drawResult(tool: any, fixture: ToolFixture, expanded: boolean, width: number): string[] {
		const isPartial = fixture.options?.isPartial ?? false;
		const component = tool.renderResult(
			fixture.result,
			{ expanded, isPartial },
			fakeTheme,
			context({
				args: fixture.args ?? {},
				expanded,
				isPartial,
				isError: fixture.result?.isError === true,
				durationMs: fixture.options?.durationMs,
				state: fixtureState(fixture),
			}),
		);
		return component.render(width);
	}

	test("every fixture result draws bounded, control-free lines at every width", () => {
		const tools = registeredTools();
		for (const fixture of FIXTURES) {
			if (fixture.group !== "package" || fixture.result === undefined) continue;
			// A variant fixture (`web_fetch-rejected`) renders the real tool's renderer;
			// its own name is only the gallery label. A fixture whose tool this pack does
			// not register here (`worktree`, `open_path`) is the generic fallback's.
			const tool = tools.get(fixture.tool ?? fixture.name);
			if (typeof tool?.renderResult !== "function") continue;
			for (const width of WIDTHS) {
				const collapsed = drawResult(tool, fixture, false, width);
				expect(collapsed, `${fixture.name} result drew nothing at ${width}`).not.toHaveLength(0);
				expectBounded(collapsed, width, `${fixture.name} result at ${width}`);
				const expanded = drawResult(tool, fixture, true, width);
				expectBounded(expanded, width, `${fixture.name} expanded result at ${width}`);
				// Expanding lifts a collapse, it never sheds a row: a tool that hides
				// lines collapsed draws them here, and one with nothing hidden draws the same.
				expect(expanded.length, `${fixture.name} expanded to fewer lines at ${width}`).toBeGreaterThanOrEqual(
					collapsed.length,
				);
				// The reading, not the shape: a row may fold its suffix onto a second line when the
				// terminal is narrow, but a block that loses the token naming what it lists is what
				// no width, control-character or line-count assertion above can see. Joined first,
				// because a folded row keeps its identity on a line of its own.
				if (fixture.identity) {
					const shown = expanded.join(" ").replace(/\s+/g, " ");
					expect(shown, `${fixture.name} lost ${fixture.identity} at ${width}`).toContain(fixture.identity);
				}
			}
		}
	});

	/**
	 * The number a running fixture draws: `elapsedMs` puts the call's clock that far
	 * back, so the block shows the elapsed its label promises instead of a verb alone.
	 *
	 * The seed is stamped just before the renderer reads the clock, and the drawn
	 * number is a tenth of a second, so a stall of a few milliseconds is a rounding
	 * rather than a failure — but a seed read as an exact string would be.
	 */
	test("a running fixture draws the elapsed its clock was seeded with", () => {
		const tools = registeredTools();
		let seeded = 0;
		for (const fixture of FIXTURES) {
			const elapsedMs = fixture.options?.elapsedMs;
			if (elapsedMs === undefined) continue;
			seeded += 1;
			const tool = tools.get(fixture.tool ?? fixture.name);
			expect(typeof tool?.renderResult, `${fixture.name} has no renderer`).toBe("function");
			const drawn = drawResult(tool, fixture, false, 80).join(" ");
			const shown = /· (\d+(?:\.\d+)?)s/.exec(drawn)?.[1];
			expect(shown, `${fixture.name} drew no elapsed number`).toBeDefined();
			expect(Math.abs(Number(shown) * 1000 - elapsedMs), `${fixture.name} drew ${shown}s`).toBeLessThanOrEqual(500);
		}
		expect(seeded, "no fixture seeds a clock").toBeGreaterThan(0);
	});

	test("bytefly's frame reuses its lines on an unchanged frame", () => {
		const fake = createFakePi();
		for (const extension of EXTENSIONS) extension(fake.pi);
		const frame: any = fake.toolRenderers[0];
		expect(frame, "bytefly registered no tool frame").toBeDefined();
		const rejected: any = {
			content: [{ type: "text", text: "Error: Permission denied" }],
			details: {},
			isError: true,
		};

		for (const [name, tool] of fake.tools) {
			const wrapped = frame(name, () => tool);
			for (const width of WIDTHS) {
				for (const state of CALL_STATES) {
					const call = wrapped.renderCall({}, fakeTheme, context({ state: {}, ...state }));
					const first = call.render(width);
					expect(call.render(width), `${name} call rebuilt at ${width}`).toBe(first);
				}
				for (const state of RESULT_STATES) {
					const result = wrapped.renderResult(
						rejected,
						{ expanded: state.expanded, isPartial: state.isPartial },
						fakeTheme,
						context({ state: {}, isError: true, ...state }),
					);
					const first = result.render(width);
					expect(result.render(width), `${name} result rebuilt at ${width}`).toBe(first);
				}
			}
		}
	});

	test("a rejected call renders sanitized in the error role at every width", () => {
		for (const [name, tool] of registeredTools()) {
			if (typeof tool.renderResult !== "function") continue;
			const rejected = {
				content: [{ type: "text", text: `Error: Permission denied: ${name}` }],
				details: {},
				isError: true,
			};
			for (const width of WIDTHS) {
				const options = { expanded: false, isPartial: false };
				const component = tool.renderResult(rejected, options, fakeTheme, context({ isError: true }));
				const lines = component.render(width);
				expectBounded(lines, width, `${name} rejection at ${width}`);
				const text = lines.join(" ").replace(/\s+/g, " ");
				expect(text, `${name} lost the rejection message`).toContain(`Permission denied: ${name}`);
				expect(text, `${name} dropped the error prefix`).toContain("Error:");
				expect(text.includes("Error: Error:"), `${name} doubled the error prefix`).toBe(false);
			}
		}
	});
});

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
const COLLAPSED_ROWS: Record<string, number> = {
	board: 2,
	"board-archived": 2,
	"board-contract": 2,
	"board-gated": 4,
	"board-refused": 2,
	goal: 2,
	job: 3,
	memory: 3,
	"memory-long-subject": 3,
	open_path: 2,
	plan: 2,
	"plan-cancel": 2,
	"plan-exit": 13,
	"plan-steps": 2,
	"plan-steps-batch": 2,
	"plan-write": 2,
	question: 5,
	"question-cancelled": 3,
	read_doc: 2,
	"read_doc-running": 2,
	run_doctor: 2,
	send_wechat: 2,
	"send_wechat-file": 2,
	"send_wechat-running": 2,
	session: 2,
	"session-name": 2,
	subagent: 13,
	"subagent-background": 3,
	team: 2,
	"team-assigning": 2,
	todo: 5,
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

/** The viewport the budget is measured at: Pi's transcript width on a settled terminal. */
const BUDGET_WIDTH = 80;

/** The frame and the tools, registered once for the height cases. */
function blockHarness(): { frame: any; tools: Map<string, any> } {
	const fake = createFakePi();
	for (const extension of EXTENSIONS) extension(fake.pi);
	const frame: any = fake.toolRenderers[0];
	expect(frame, "bytefly registered no tool frame").toBeDefined();
	return { frame, tools: fake.tools };
}

/** The package fixtures the budget covers: collapsed, with a result to draw. */
function collapsedFixtures(): ToolFixture[] {
	return FIXTURES.filter(
		(fixture) => fixture.group === "package" && fixture.result !== undefined && fixture.options?.expanded !== true,
	);
}

/**
 * One fixture's collapsed block: the call line and the result the transcript draws
 * before any expand, through the frame that draws it there.
 */
function collapsedBlock(frame: any, tools: Map<string, any>, fixture: ToolFixture, width: number): string[] {
	const name = fixture.tool ?? fixture.name;
	const wrapped = frame(name, () => tools.get(name));
	const isPartial = fixture.options?.isPartial ?? false;
	const args = fixture.args ?? {};
	const call = wrapped.renderCall?.(args, fakeTheme, context({ args, isPartial }));
	const result = wrapped.renderResult?.(
		fixture.result,
		{ expanded: false, isPartial },
		fakeTheme,
		context({
			args,
			expanded: false,
			isPartial,
			isError: fixture.result?.isError === true,
			durationMs: fixture.options?.durationMs,
			state: fixtureState(fixture),
		}),
	);
	return [...(call?.render(width) ?? []), ...(result?.render(width) ?? [])];
}

describe("collapsed block height", () => {
	test("every package fixture is named in the row budget", () => {
		const drawn = collapsedFixtures().map((fixture) => fixture.name);
		const named = new Set(Object.keys(COLLAPSED_ROWS));
		expect(
			drawn.filter((name) => !named.has(name)),
			"record the block's height in COLLAPSED_ROWS so a later row has a number to beat",
		).toEqual([]);
		expect(
			[...named].filter((name) => !drawn.includes(name)),
			"a stale entry names no collapsed fixture; drop it",
		).toEqual([]);
	});

	test("a collapsed block stays inside its row budget", () => {
		const { frame, tools } = blockHarness();
		const over: string[] = [];
		for (const fixture of collapsedFixtures()) {
			const ceiling = COLLAPSED_ROWS[fixture.name] ?? 0;
			const rows = collapsedBlock(frame, tools, fixture, BUDGET_WIDTH).length;
			if (rows > ceiling) over.push(`${fixture.name} drew ${rows} rows at ${BUDGET_WIDTH}, ceiling ${ceiling}`);
		}
		expect(over, "trim the block, or raise its entry in COLLAPSED_ROWS and write the reason beside it").toEqual([]);
	});
});
