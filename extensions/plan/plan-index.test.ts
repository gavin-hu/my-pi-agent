import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme as theme } from "../../test/helpers/fakes.ts";
import { fixedPlanDate } from "../../test/helpers/fixtures/plan.ts";
import { settle } from "../../test/helpers/process.ts";
import { type PlanSummary } from "./plans.ts";
import { formatPlanIndex, PlanIndexComponent, relativeAge } from "./plan-index.ts";

/** A fixed clock: the plan fixture's date, so an age is reproducible. */
const NOW = fixedPlanDate().getTime();
const DAY = 86_400_000;

/** A summary for a plan modified `days` before NOW. */
function summary(over: Partial<PlanSummary> = {}): PlanSummary {
	return {
		path: "/repo/.pi/plans/2026-10-16-1030-add-rate-limiting.md",
		relativePath: ".pi/plans/2026-10-16-1030-add-rate-limiting.md",
		title: "Add rate limiting",
		modified: NOW - 2 * DAY,
		bytes: 512,
		steps: { done: 3, total: 7 },
		...over,
	};
}

interface HarnessOptions {
	summaries?: readonly PlanSummary[];
	reload?: () => Promise<readonly PlanSummary[]>;
}

function harness(options: HarnessOptions = {}) {
	const selected: PlanSummary[] = [];
	let closed = 0;
	const component = new PlanIndexComponent({
		summaries: options.summaries ?? [summary(), summary({ title: "Older plan", modified: NOW - 40 * DAY })],
		dir: "/repo/.pi/plans",
		theme,
		now: () => NOW,
		onSelect: (plan) => selected.push(plan),
		onClose: () => {
			closed += 1;
		},
		reload: options.reload ?? (async () => options.summaries ?? []),
		requestRender: () => {},
		viewportRows: () => 24,
	});
	return {
		component,
		selected,
		closeCount: () => closed,
		text: (width = 80): string => component.render(width).join("\n"),
		input: (data: string): void => component.handleInput(data),
		mouse: (delta: number): unknown => component.handleMouse({ type: "wheel", wheelDelta: delta } as any),
	};
}

describe("relativeAge", () => {
	test("reports today, days, months, and years", () => {
		expect(relativeAge(NOW, NOW)).toBe("today");
		expect(relativeAge(NOW - DAY, NOW)).toBe("1d ago");
		expect(relativeAge(NOW - 3 * DAY, NOW)).toBe("3d ago");
		expect(relativeAge(NOW - 45 * DAY, NOW)).toBe("1mo ago");
		expect(relativeAge(NOW - 400 * DAY, NOW)).toBe("1y ago");
	});

	test("never reports a negative age for a future mtime", () => {
		expect(relativeAge(NOW + DAY, NOW)).toBe("today");
	});
});

describe("formatPlanIndex", () => {
	test("names the directory and one line per plan, newest first", () => {
		const text = formatPlanIndex(
			[summary(), summary({ title: "Older plan", modified: NOW - 40 * DAY, steps: { done: 0, total: 2 } })],
			"/repo/.pi/plans",
		);
		const lines = text.split("\n");
		expect(lines[0]).toBe("Plans (2) — /repo/.pi/plans");
		expect(lines[1]).toContain("Add rate limiting — 3/7 steps — 2026-10-06 15:30");
		expect(lines[1]).toContain(".pi/plans/2026-10-16-1030-add-rate-limiting.md");
		expect(lines[2]).toContain("Older plan — 0/2 steps");
	});

	test("says where plans go when there are none", () => {
		expect(formatPlanIndex([], "/repo/.pi/plans")).toBe("No plans in /repo/.pi/plans yet; write_plan saves one there.");
	});

	test("reports a file it did not read as unknown steps", () => {
		const text = formatPlanIndex([summary({ steps: undefined, oversize: true })], "/repo/.pi/plans");
		expect(text).toContain("steps unknown");
	});

	test("sanitizes a title before it reaches the notice", () => {
		const text = formatPlanIndex([summary({ title: "bad\u0001title" })], "/repo/.pi/plans");
		expect(text).toContain("bad title");
		expect(text).not.toContain("\u0001");
	});
});

describe("PlanIndexComponent render", () => {
	test("lists plans with step progress and age, newest first", () => {
		const h = harness();
		expect(h.text()).toContain("❯ Add rate limiting");
		expect(h.text()).toContain("3/7 steps · 2d ago");
		expect(h.text()).toContain("Older plan");
		expect(h.text()).toContain("1mo ago");
	});

	test("shows the focused plan's path and modified time", () => {
		const h = harness();
		expect(h.text()).toContain(".pi/plans/2026-10-16-1030-add-rate-limiting.md");
		expect(h.text()).toContain("modified 2026-10-06 15:30");
	});

	test("shows an empty state", () => {
		expect(harness({ summaries: [] }).text()).toContain("No plans yet");
	});

	test("stays within the width", () => {
		const h = harness();
		for (const width of [80, 40, 20, 12, 6, 1]) {
			for (const line of h.component.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	test("scrolls its range row when the plans overflow", () => {
		const many = Array.from({ length: 30 }, (_, index) => summary({ title: `Plan ${index}` }));
		const h = harness({ summaries: many });
		expect(h.text()).toMatch(/1–\d+ of 30/);
	});
});

describe("PlanIndexComponent navigation", () => {
	test("moves the selection with j/k and the wheel", () => {
		const h = harness();
		h.input("j");
		expect(h.text()).toContain("❯ Older plan");
		h.mouse(1);
		expect(h.text()).toContain("❯ Older plan");
		h.input("k");
		expect(h.text()).toContain("❯ Add rate limiting");
	});

	test("g and G jump to the ends", () => {
		const many = Array.from({ length: 20 }, (_, index) => summary({ title: `Plan ${index}` }));
		const h = harness({ summaries: many });
		h.input("G");
		expect(h.text()).toContain("❯ Plan 19");
		h.input("g");
		expect(h.text()).toContain("❯ Plan 0");
	});

	test("closes on Escape", () => {
		const h = harness();
		h.input("\x1b");
		expect(h.closeCount()).toBe(1);
	});
});

describe("PlanIndexComponent actions", () => {
	test("Enter hands the focused plan to the caller", () => {
		const h = harness();
		h.input("j");
		h.input("\r");
		expect(h.selected).toEqual([h.selected[0]]);
		expect(h.selected[0]?.title).toBe("Older plan");
	});

	test("Enter with no plans selects nothing", () => {
		const h = harness({ summaries: [] });
		h.input("\r");
		expect(h.selected).toEqual([]);
	});

	test("r reloads the rows and reports an empty directory", async () => {
		const h = harness({ reload: async () => [] });
		h.input("r");
		await settle();
		expect(h.text()).toContain("No plans yet");
		expect(h.text()).toContain("No plans yet.");
	});

	test("a failed reload reports the reason instead of throwing", async () => {
		const h = harness({
			reload: async () => {
				throw new Error("permission denied");
			},
		});
		h.input("r");
		await settle();
		expect(h.text()).toContain("Could not read the plans directory: permission denied");
	});
});
