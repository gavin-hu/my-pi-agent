import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { RewindListComponent, type RewindListOptions } from "./rewind-tui.ts";
import type { RewindPoint } from "./timeline.ts";
import { makeSnapshot } from "../../test/helpers/fixtures/rewind.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";

/** Identity theme so text stays assertable. */
const theme = fakeTheme;

const points: RewindPoint[] = [
	{ entryId: "e1", prompt: "fix the list", summary: "fix the list", timestamp: 1000 },
	{
		entryId: "e2",
		prompt: "add tests",
		summary: "add tests",
		timestamp: 2000,
		snapshot: makeSnapshot({ id: "c2", entryId: "e2" }),
	},
];

function makeComponent(overrides: Partial<RewindListOptions> = {}): RewindListComponent {
	return new RewindListComponent({
		points,
		theme,
		onClose: () => {},
		requestRender: () => {},
		...overrides,
	});
}

describe("RewindListComponent", () => {
	test("renders an empty-state hint", () => {
		const lines = makeComponent({ points: [] }).render(60);
		expect(lines.join("\n")).toContain("No prompts on this branch yet.");
	});

	test("closes with no point on Escape", () => {
		let closed: RewindPoint | undefined | "called" = "called";
		const component = makeComponent({ onClose: (point?: RewindPoint) => (closed = point) });
		component.handleInput("\u001b");
		expect(closed).toBeUndefined();
	});

	test("keeps the close hint on a narrow footer", () => {
		const text = makeComponent().render(20).join("\n");
		expect(text).toContain("Esc close");
		expect(text).not.toContain("Enter rewind");
	});

	test("renders prompts and marks code snapshots", () => {
		const body = makeComponent().render(60).join("\n");
		expect(body).toContain("fix the list");
		expect(body).toContain("add tests");
		// The focused row (first, conversation-only) shows its detail line.
		expect(body).toContain("conversation only");
		// The code point carries the snapshot marker.
		expect(body).toContain("◆");
	});

	test("shows the focused point's snapshot id in the detail line", () => {
		const component = makeComponent();
		component.handleInput("\u001b[B"); // down to the code point
		expect(component.render(60).join("\n")).toContain("code snapshot #c2");
	});

	test("keeps the header border within the width", () => {
		const lines = makeComponent().render(40);
		expect(visibleWidth(lines[0])).toBe(40);
	});

	test("never exceeds the available width", () => {
		const wide = [{ entryId: "e", prompt: "x".repeat(300), summary: "x".repeat(300), timestamp: 1000 }];
		const lines = makeComponent({ points: wide }).render(24);
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
	});

	test("sizes the window to the terminal height", () => {
		const many: RewindPoint[] = Array.from({ length: 30 }, (_, i) => ({
			entryId: `e${i}`,
			prompt: `prompt ${i}`,
			summary: `prompt ${i}`,
			timestamp: 1000,
		}));

		const short = makeComponent({ points: many, viewportRows: 15 }).render(60).join("\n");
		expect(short).toContain("showing 1–5 of 30");
		expect(short).not.toContain("prompt 6");

		const tall = makeComponent({ points: many, viewportRows: 60 }).render(60).join("\n");
		expect(tall).toContain("prompt 29");
		expect(tall).not.toContain("showing");
	});

	test("drops the title instead of ellipsizing the border when very narrow", () => {
		const lines = makeComponent().render(6);
		expect(visibleWidth(lines[0])).toBe(6);
		expect(lines[0]).not.toContain("...");
	});

	test("windows long lists and scrolls as the cursor moves", () => {
		const many: RewindPoint[] = Array.from({ length: 30 }, (_, i) => ({
			entryId: `e${i}`,
			prompt: `prompt ${i}`,
			summary: `prompt ${i}`,
			timestamp: 1000,
		}));
		let renders = 0;
		const component = makeComponent({ points: many, requestRender: () => renders++ });

		const first = component.render(60).join("\n");
		expect(first).toContain("prompt 0");
		expect(first).not.toContain("prompt 12");
		expect(first).toContain("showing 1–12 of 30");

		component.handleInput("\u001b[B"); // down: cursor moves, window stays
		expect(renders).toBe(1);
		expect(component.render(60).join("\n")).toContain("showing 1–12 of 30");

		component.handleInput("\u001b[6~"); // page down: window shifts
		expect(component.render(60).join("\n")).toContain("showing 3–14 of 30");

		component.handleInput("\u001b[F"); // end
		expect(component.render(60).join("\n")).toContain("showing 19–30 of 30");
	});

	test("Enter selects the focused point", () => {
		const chosen: RewindPoint[] = [];
		const component = makeComponent({ onClose: (point?: RewindPoint) => point && chosen.push(point) });

		component.handleInput("\u001b[B"); // down to the second point
		component.handleInput("\r"); // Enter
		expect(chosen).toEqual([points[1]]);
	});

	test("the wheel moves the selection", () => {
		const component = makeComponent();
		component.render(60);
		expect(component.handleMouse({ type: "wheel", wheelDelta: 1 } as any)).toEqual({ handled: true });
		const selected = component.render(60).find((line) => line.startsWith("❯"));
		expect(selected).toContain("add tests");
		expect(component.handleMouse({ type: "click", button: "left" } as any)).toBeUndefined();
	});
});
