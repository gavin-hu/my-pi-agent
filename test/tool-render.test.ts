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
import { ToolCallText } from "../lib/tui/tool.ts";
import { FIXTURES, type ToolFixture } from "../scripts/tools/fixtures/index.ts";
import { fixtureState } from "../scripts/tools/fixtures/state.ts";
import { fakeTheme } from "./helpers/fakes.ts";
import { ALL_EXTENSIONS_ENV, useEnv } from "./helpers/env.ts";
import {
	COLLAPSED_ROWS,
	WIDTHS,
	blockHarness,
	expectBlockBounded,
	registeredTools,
	toolBlockContext,
} from "./helpers/tool-block.ts";

/** Every tool here is rendered, so the fake session loads the whole pack. */
const env = useEnv(ALL_EXTENSIONS_ENV);

/**
 * The process theme an expanded subagent block draws with: it renders Pi's
 * Markdown, which reads the theme a session initializes and no renderer can be
 * handed. A width assertion strips the colour, so the system palette is enough.
 */
initTheme();

afterAll(() => env.restore());

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

describe("tool render contract", () => {
	test("every renderCall draws bounded, control-free lines", () => {
		for (const [name, tool] of registeredTools()) {
			if (typeof tool.renderCall !== "function") continue;
			for (const width of WIDTHS) {
				const component = tool.renderCall({}, fakeTheme, toolBlockContext());
				expect(component, `${name} renderCall returned nothing`).toBeDefined();
				const lines = component.render(width);
				if (component instanceof ToolCallText) {
					expect(lines, `${name} call wrapped at ${width}`).toHaveLength(component.text.split("\n").length);
				}
				expectBlockBounded(lines, width, `${name} call at ${width}`);
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
			toolBlockContext({
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
				// A block whose budget is one row draws its call line and no body: `goal` and
				// `plan enter` state what the widget and the status line already show (#742).
				// Every other result draws something, which is what this catches.
				if (COLLAPSED_ROWS[fixture.name] !== 1) {
					expect(collapsed, `${fixture.name} result drew nothing at ${width}`).not.toHaveLength(0);
				}
				expectBlockBounded(collapsed, width, `${fixture.name} result at ${width}`);
				const expanded = drawResult(tool, fixture, true, width);
				expectBlockBounded(expanded, width, `${fixture.name} expanded result at ${width}`);
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
		const { frame, tools } = blockHarness();
		const rejected: any = {
			content: [{ type: "text", text: "Error: Permission denied" }],
			details: {},
			isError: true,
		};

		for (const [name, tool] of tools) {
			const wrapped = frame(name, () => tool);
			for (const width of WIDTHS) {
				for (const state of CALL_STATES) {
					const call = wrapped.renderCall({}, fakeTheme, toolBlockContext({ state: {}, ...state }));
					const first = call.render(width);
					expect(call.render(width), `${name} call rebuilt at ${width}`).toBe(first);
				}
				for (const state of RESULT_STATES) {
					const result = wrapped.renderResult(
						rejected,
						{ expanded: state.expanded, isPartial: state.isPartial },
						fakeTheme,
						toolBlockContext({ state: {}, isError: true, ...state }),
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
				const component = tool.renderResult(rejected, options, fakeTheme, toolBlockContext({ isError: true }));
				const lines = component.render(width);
				expectBlockBounded(lines, width, `${name} rejection at ${width}`);
				const text = lines.join(" ").replace(/\s+/g, " ");
				expect(text, `${name} lost the rejection message`).toContain(`Permission denied: ${name}`);
				expect(text, `${name} dropped the error prefix`).toContain("Error:");
				expect(text.includes("Error: Error:"), `${name} doubled the error prefix`).toBe(false);
			}
		}
	});
});
