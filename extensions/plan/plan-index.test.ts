/**
 * The plan index: what a row is named, and what the cursor is on after a reload.
 *
 * `/plan list` is the one door onto reading a plan, so two things about it are worth a
 * suite of their own: the name a row shows (the document's own H1, not a `#` inside a
 * code sample), and the row `Enter` opens after `r` re-read the directory.
 *
 * `plans.test.ts` keeps the store's own index walk; this holds the two defects found in
 * the list a user reads.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PlanIndexComponent } from "./plan-index.ts";
import { createPlanStore, type PlanSummary } from "./plans.ts";
import { tempDir, useEnv } from "../../test/helpers/env.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { fixedPlanDate, planRepoPi } from "../../test/helpers/fixtures/plan.ts";
import { settle } from "../../test/helpers/process.ts";

const FIXED = fixedPlanDate();
/** One agent directory for this file: plans live outside the project, so a test must not write the real one. */
const AGENT = tempDir("pi-plan-index-agent-");
let scoped: { restore: () => void } | undefined;
beforeEach(() => {
	scoped = useEnv({ PI_CODING_AGENT_DIR: AGENT });
});
afterEach(() => {
	scoped?.restore();
	scoped = undefined;
});
afterAll(() => {
	rmSync(AGENT, { recursive: true, force: true });
});

/** A summary a component can render, so the reload cases need no files. */
function summary(name: string): PlanSummary {
	return {
		path: `/plans/2026-10-0${name.at(-1) ?? "1"}-0900-${name}.md`,
		relativePath: `~/.pi/agent/plans/key/2026-10-0${name.at(-1) ?? "1"}-0900-${name}.md`,
		title: name,
		modified: FIXED.getTime(),
		bytes: 40,
	};
}

/** A component over `rows`, with the reload it is asked for recorded. */
function screen(rows: readonly PlanSummary[], reloads: PlanSummary[][] = []) {
	const picked: string[] = [];
	const frames: number[] = [];
	const component = new PlanIndexComponent({
		summaries: rows,
		dir: "~/.pi/agent/plans/key",
		theme: fakeTheme,
		onSelect: (chosen) => {
			picked.push(chosen.relativePath);
		},
		onClose: () => {},
		reload: async () => reloads.shift() ?? rows,
		requestRender: () => {
			frames.push(1);
		},
		viewportRows: () => 24,
		now: () => FIXED.getTime(),
	});
	return { component, picked, frames };
}

describe("the name a row shows", () => {
	test("is the document's own H1, not a heading inside a code sample", async () => {
		const root = tempDir("pi-plan-index-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		// A plan that opens with a shell sample: `# build` is a comment in it, not a title.
		writeFileSync(join(dir, "2026-10-08-1530-sample.md"), "```bash\n# build\n```\n\n# Real Title\n\nBody.\n");

		const rows = await store.index(root);

		expect(rows.map((row) => row.title)).toEqual(["Real Title"]);
	});

	test("falls back to the file-name slug when the plan has no heading", async () => {
		const root = tempDir("pi-plan-index-");
		const store = createPlanStore(planRepoPi(root), { now: () => FIXED });
		const dir = await store.dirFor(root);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "2026-10-08-1530-no-heading.md"), "Body only.\n");

		const rows = await store.index(root);

		expect(rows.map((row) => row.title)).toEqual(["no-heading"]);
	});
});

describe("the row Enter opens", () => {
	test("stays on the focused plan when a newer one appears above it", async () => {
		const older = summary("older1");
		const mine = summary("mine2");
		const { component, picked } = screen([mine, older], [[summary("newer3"), mine, older]]);

		// The reader moved to the second row, then the directory gained a plan on top.
		component.handleInput("\u001b[B");
		component.handleInput("r");
		// A reload re-reads the directory off the render path: the rows land a tick later.
		await settle(0);
		component.handleInput("\r");

		expect(picked).toEqual([older.relativePath]);
	});

	test("falls back to the same row when the focused plan was deleted", async () => {
		const first = summary("first1");
		const gone = summary("gone2");
		const { component, picked } = screen([first, gone], [[first]]);

		component.handleInput("\u001b[B");
		component.handleInput("r");
		await settle(0);
		component.handleInput("\r");

		// The plan is gone, so the row it occupied is the closest truthful answer.
		expect(picked).toEqual([first.relativePath]);
	});
});
