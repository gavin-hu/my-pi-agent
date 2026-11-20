/**
 * The plan tool's results at a width: a saved path stays one token.
 *
 * The defect this holds is geometric, so every case measures rather than matches: a result line is
 * one line, it fits the width, and the tail a reader scans for survives. On the tree before #738
 * `write`'s result was a string inside Pi's `Text`, which can only wrap, so at 40 columns
 * `✓ Saved plan ~/.pi/agent/plans/…/2026-10` / `-29-1015-add-rate-limiting.md` was four lines — and
 * a `toContain` was green on it, which is why the cases read the line count.
 *
 * It reads the tool's real `renderResult` through `registerTools`, not a stand-in, so the wiring
 * from result to component is what these cases hold. It is its own suite because `tools.test.ts` is
 * named at its height in `test/suite-sizes.test.ts`, and this is the width's subject rather than
 * the plan tool's vocabulary. The cross-tool case that reads every rendering through the shared
 * fixture waits on #737's release of `test/tool-render.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme, toolRenderContext } from "../../test/helpers/fakes.ts";
import { makePlanPi } from "../../test/helpers/fixtures/plan.ts";
import { createPlanPolicy } from "./policy.ts";
import { createPlanRuntime, PLAN_TOOL } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** The widths a split pane, a default terminal and a wide one give a transcript. */
const WIDTHS = [40, 100, 120];

/** The plan the card was filed on, as the tool records it: a `~`-shortened relative path. */
const PATH = "~/.pi/agent/plans/8872d3adda0e/2026-10-29-1015-add-rate-limiting.md";

/** One action of the registered `plan` tool, with its real `renderResult`. */
function planTool() {
	const fake = makePlanPi({ active: ["read", "bash", PLAN_TOOL] });
	registerTools(fake.pi as unknown as ExtensionAPI, createPlanRuntime(fake.pi, createPlanPolicy(fake.pi)));
	return fake.tools.get(PLAN_TOOL) as unknown as {
		renderResult(
			result: unknown,
			options: { expanded: boolean },
			theme: unknown,
			context: unknown,
		): { render(width: number): string[] };
	};
}

/** What a result component draws at a width, as the strings a frame shows. */
function linesAt(component: { render(width: number): string[] }, width: number): string[] {
	return component.render(width).map((line) => stripTerminalSequences(line));
}

/** A result as Pi hands it back, with the action its details carry. */
function result(action: string, details: Record<string, unknown>) {
	return { content: [{ type: "text", text: "…" }], details: { action, ...details } };
}

describe("a plan write result at a width", () => {
	test("keeps the saved path on one line that fits, at every width", () => {
		const tool = planTool();
		const options = { expanded: true };
		const component = tool.renderResult(
			result("write", { relativePath: PATH, path: `/home/u/${PATH.slice(2)}` }),
			options,
			fakeTheme,
			toolRenderContext(options),
		);
		for (const width of WIDTHS) {
			const lines = linesAt(component, width);
			expect(lines, `${width} columns`).toHaveLength(1);
			expect(visibleWidth(lines[0] ?? ""), `${width} columns`).toBeLessThanOrEqual(width);
			expect(lines[0], `${width} columns names the file`).toContain("rate-limiting.md");
		}
	});
});

describe("a plan exit result at a width", () => {
	test("keeps the plan's path on a line that fits, and lets the body wrap under it", () => {
		const tool = planTool();
		const options = { expanded: true };
		const component = tool.renderResult(
			result("exit", { approved: true, relativePath: PATH, plan: "# A plan\n\n## Steps\n- [ ] one\n" }),
			options,
			fakeTheme,
			toolRenderContext(options),
		);
		for (const width of WIDTHS) {
			const lines = linesAt(component, width);
			// A heading, the path, a blank line, then the body — not four lines of path.
			expect(lines.length, `${width} columns`).toBeGreaterThan(3);
			const path = lines.find((line) => line.includes("…") || line.includes("plans/"));
			expect(path, `${width} columns draws the path`).toBeDefined();
			expect(visibleWidth(path ?? ""), `${width} columns`).toBeLessThanOrEqual(width);
			expect(path, `${width} columns names the file`).toContain("rate-limiting.md");
			for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
