/**
 * The `/context` screen: rendering, width safety, scroll, refresh, and the one
 * action behind a confirmation.
 *
 * The component is built with a plain options object, so these tests drive the
 * screen without a host: `read` and `compact` are recorders, and the terminal
 * height is a number.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildReport } from "./report.ts";
import { ContextComponent, type ContextCompactCallbacks, type ContextScreenOptions } from "./tui.ts";
import type { ContextReport } from "./types.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { sampleContext } from "../../test/helpers/fixtures/context.ts";
import { GLYPHS } from "../../lib/tui/glyphs.ts";

/** A screen with recorder callbacks and a mutable report source. */
function makeScreen(overrides: Partial<ContextScreenOptions> = {}, next?: ContextReport) {
	let reads = 0;
	let renders = 0;
	const compactions: Array<{ instructions: string | undefined; callbacks: ContextCompactCallbacks }> = [];
	const closes: number[] = [];
	const report = buildReport(sampleContext());

	const options: ContextScreenOptions = {
		theme: fakeTheme,
		report,
		read: () => {
			reads += 1;
			return next ?? report;
		},
		isIdle: () => true,
		compact: (instructions, callbacks) => {
			compactions.push({ instructions, callbacks });
		},
		close: () => {
			closes.push(1);
		},
		requestRender: () => {
			renders += 1;
		},
		viewportRowsSource: () => 40,
		...overrides,
	};
	const component = new ContextComponent(options);
	return {
		component,
		report,
		compactions,
		closes,
		reads: () => reads,
		renders: () => renders,
		text: (width = 80) => component.render(width).join("\n"),
	};
}

describe("the context screen", () => {
	test("renders the headline, the rows, and the action", () => {
		const { component } = makeScreen();
		const lines = component.render(80);
		expect(lines[0]).toContain("Context");
		const text = lines.join("\n");
		expect(text).toContain("124k / 200k");
		expect(text).toContain("62%");
		expect(text).toContain("Tool definitions");
		expect(text).toContain("Compaction");
		expect(text).toContain("c compact");
	});

	test("separates the longest role from its label", () => {
		// "tool result" fills the padded role column exactly, so the label used to run
		// straight into it as "tool resultread".
		const report = buildReport(sampleContext());
		const crafted: ContextReport = {
			...report,
			largest: [{ tokens: 12000, role: "tool result", label: "read" }],
		};
		const row =
			makeScreen({ report: crafted })
				.component.render(80)
				.find((line) => line.includes("read")) ?? "";
		expect(row).toContain("tool result read");
	});

	test("draws the gauge from the percentage it prints", () => {
		const { component } = makeScreen({
			report: buildReport(
				sampleContext({ window: 1000000, usage: { tokens: 26, contextWindow: 1000000, percent: 0.0026 } }),
			),
		});
		const gauge = component.render(80).find((line) => line.includes("/ 1.0M")) ?? "";
		expect(gauge).toContain("0%");
		expect(gauge).toContain(GLYPHS.gaugeEmpty.repeat(10));
		expect(gauge).not.toContain(GLYPHS.gaugeFull);
	});

	test("fills a row's bar from the share it prints", () => {
		const report = buildReport(sampleContext());
		const crafted: ContextReport = {
			...report,
			buckets: [{ id: "system", label: "System prompt", tokens: 483, share: 48.3, depth: 0 }],
		};
		const row =
			makeScreen({ report: crafted })
				.component.render(80)
				.find((line) => line.includes("48.3%")) ?? "";
		expect(row).toContain(`${GLYPHS.gaugeFull.repeat(4)}${GLYPHS.gaugeEmpty.repeat(4)}`);
	});

	test("names the composition total above the rows", () => {
		expect(makeScreen().component.render(80).join("\n")).toContain("Composition · 545 estimate");
	});

	test("drops the composition total when the width cannot hold it", () => {
		const narrow = makeScreen().component.render(24).join("\n");
		expect(narrow).toContain("Composition");
		expect(narrow).not.toContain("estimate");
	});

	test("does not clip an injected type in its child row", () => {
		const messages = [
			{
				role: "custom",
				customType: "my-pi-agent/notice",
				content: "n".repeat(104),
				display: false,
				timestamp: 0,
			} as unknown as AgentMessage,
		];
		const { component } = makeScreen({ report: buildReport(sampleContext({ messages })) });
		expect(component.render(80).join("\n")).toContain("my-pi-agent/notice");
	});

	test("drops the optional columns as the terminal narrows", () => {
		const wide = makeScreen().component.render(80).join("\n");
		expect(wide).toContain("36.7%");
		expect(wide).toContain("3 active of 5");

		const narrow = makeScreen().component.render(30).join("\n");
		expect(narrow).toContain("Tool definitions");
		expect(narrow).not.toContain("3 active of 5");
	});

	test("keeps every line inside the terminal at any width", () => {
		for (const width of [100, 80, 40, 24, 12]) {
			const { component } = makeScreen();
			for (const line of component.render(width)) {
				expect(visibleWidth(line), `${width}: ${line}`).toBeLessThanOrEqual(width);
			}
		}
	});

	test("says when the window is unknown", () => {
		const { component } = makeScreen({
			report: buildReport(sampleContext({ window: 0, usage: undefined })),
		});
		expect(component.render(80).join("\n")).toContain("no model context window");
	});

	test("scrolls a long body and shows the range", () => {
		const { component } = makeScreen({ viewportRowsSource: () => 12 });
		const first = component.render(80).join("\n");
		expect(first).toContain("showing 1–");

		component.handleInput("j");
		const second = component.render(80).join("\n");
		expect(second).toContain("showing 2–");
	});

	test("jumps to the start and the end with g and G", () => {
		const { component } = makeScreen({ viewportRowsSource: () => 12 });
		component.render(80);

		component.handleInput("G");
		expect(component.render(80).join("\n")).not.toContain("showing 1–");

		component.handleInput("g");
		expect(component.render(80).join("\n")).toContain("showing 1–");
	});

	test("r re-reads the report", () => {
		const latest = buildReport(sampleContext({ usage: { tokens: 1000, contextWindow: 200000, percent: 0.5 } }));
		const { component, reads } = makeScreen({}, latest);
		component.handleInput("r");
		expect(reads()).toBe(1);
		expect(component.render(80).join("\n")).toContain("Refreshed.");
		expect(component.render(80).join("\n")).toContain("1.0k / 200k");
	});

	test("asks before compacting and dismisses on n", () => {
		const { component, compactions, text } = makeScreen();
		component.handleInput("c");
		expect(text()).toContain("Compact the conversation now? y/N");
		component.handleInput("n");
		expect(compactions).toHaveLength(0);
		expect(text()).toContain("c compact");
	});

	test("compacts on y and reports the before and after", () => {
		const { component, compactions, reads, text } = makeScreen();
		component.handleInput("c");
		component.handleInput("y");
		expect(compactions).toHaveLength(1);
		expect(compactions[0]?.instructions).toBeUndefined();
		expect(text()).toContain("Compacting…");

		compactions[0]?.callbacks.done({
			summary: "s",
			firstKeptEntryId: "kept",
			tokensBefore: 180000,
			estimatedTokensAfter: 40000,
		});
		expect(reads()).toBe(1);
		expect(text()).toContain("Compacted 180k → 40k");
	});

	test("refuses to compact while the agent is running", () => {
		const { component, compactions, text } = makeScreen({ isIdle: () => false });
		component.handleInput("c");
		component.handleInput("y");
		expect(compactions).toHaveLength(0);
		expect(text()).toContain("The agent is busy");
	});

	test("shows a compaction failure", () => {
		const { component, compactions, text } = makeScreen();
		component.handleInput("c");
		component.handleInput("y");
		compactions[0]?.callbacks.fail(new Error("boom"));
		expect(text()).toContain("Compaction failed: boom");
	});

	test("closes on Esc and on q", () => {
		const escape = makeScreen();
		escape.component.handleInput("\u001b");
		expect(escape.closes).toHaveLength(1);

		const quit = makeScreen();
		quit.component.handleInput("q");
		expect(quit.closes).toHaveLength(1);
	});
});
