import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../test/helpers/context.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import type { BackgroundRun } from "./background.ts";
import { createSubagentUi } from "./ui.ts";

/** One background run with a stable shape. */
function run(overrides: Partial<BackgroundRun> = {}): BackgroundRun {
	return {
		id: "a1",
		agent: "explorer",
		task: "Map the auth module",
		cwd: "/repo",
		startedAt: 0,
		status: "running",
		...overrides,
	};
}

function harness(initial: BackgroundRun[] = [run()]) {
	let runs = initial;
	const ui = createSubagentUi({ runs: () => runs });
	const { ctx, notices, statuses } = fakeCtx({ mode: "tui", hasUI: true });
	return {
		ui,
		ctx,
		notices,
		statuses,
		setRuns(next: BackgroundRun[]) {
			runs = next;
		},
	};
}

describe("subagent footer status", () => {
	test("paints the running count and clears it at zero", () => {
		const h = harness();
		h.ui.attach(h.ctx);
		h.ui.paint();
		expect(h.statuses.get(STATUS_KEYS.agents)).toBe("↳ 1");

		h.setRuns([run({ status: "finished", finishedAt: 1_000 })]);
		h.ui.paint();
		expect(h.statuses.has(STATUS_KEYS.agents)).toBe(false);
	});

	test("notifies a finished run and points at /agents", () => {
		const h = harness();
		h.ui.attach(h.ctx);
		h.ui.notifyFinished(run({ status: "finished", finishedAt: 1_000 }));

		const notice = h.notices.at(-1);
		expect(notice?.kind).toBe("info");
		expect(notice?.message).toContain("Background subagent a1 (explorer) finished");
		expect(notice?.message).toContain("Use /agents to collect it.");
	});

	test("uses an error notice for a failed or timed-out run", () => {
		const h = harness();
		h.ui.attach(h.ctx);

		h.ui.notifyFinished(run({ status: "failed" }));
		expect(h.notices.at(-1)?.kind).toBe("error");
		expect(h.notices.at(-1)?.message).toContain("Use /agents to inspect it.");

		h.ui.notifyFinished(run({ status: "timedout" }));
		expect(h.notices.at(-1)?.message).toContain("timed out");
	});

	test("stays silent for a cancelled run", () => {
		const h = harness();
		h.ui.attach(h.ctx);
		const before = h.notices.length;

		h.ui.notifyFinished(run({ status: "cancelled" }));

		expect(h.notices).toHaveLength(before);
	});

	test("detach clears the chip and drops the context", () => {
		const h = harness();
		h.ui.attach(h.ctx);
		h.ui.paint();
		h.ui.detach();

		expect(h.statuses.has(STATUS_KEYS.agents)).toBe(false);
		h.ui.notifyFinished(run({ status: "finished", finishedAt: 1_000 }));
		expect(h.notices).toHaveLength(0);
	});
});
