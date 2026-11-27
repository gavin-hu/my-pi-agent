/**
 * The height a collapsed tool block is allowed, and what it must still say at every width.
 *
 * Every package fixture draws through bytefly's frame, and a block that grows a row per release
 * is a transcript nobody can scroll. `COLLAPSED_ROWS` is the ceiling each block has today —
 * it lives in `test/helpers/tool-block.ts` because the render contract in `tool-render.test.ts`
 * reads one entry to justify a collapsed draw that is its call line alone — and this suite is
 * what makes the ceiling real: the ledger, the folded refusal that must keep its instruction,
 * one case per trimmed block at three widths, and the budget itself.
 *
 * Registration only — no session hook runs, so no session state, store, or network is touched.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { FIXTURES, type ToolFixture } from "../scripts/tools/fixtures/index.ts";
import { fixtureState } from "../scripts/tools/fixtures/state.ts";
import { fakeTheme } from "./helpers/fakes.ts";
import { ALL_EXTENSIONS_ENV, useEnv } from "./helpers/env.ts";
import { textOf } from "./helpers/scan.ts";
import { BUDGET_WIDTH, COLLAPSED_ROWS, blockHarness, toolBlockContext } from "./helpers/tool-block.ts";

/** Every tool here is rendered, so the fake session loads the whole pack. */
const env = useEnv(ALL_EXTENSIONS_ENV);

/**
 * The process theme a block draws with: an expanded subagent block renders Pi's Markdown,
 * which reads the theme a session initializes and no renderer can be handed. The assertions
 * read text and row counts, so the system palette is enough.
 */
initTheme();

afterAll(() => env.restore());

/**
 * What each trimmed block must still say at every width (#742).
 *
 * The height is half the rule; the other half is that a block which trims at 80 and wraps
 * its marks away at 40 has not trimmed, it has lost the fact. Each entry names a token the
 * block exists to carry, and the cases below draw it at all three widths.
 */
const SHAPES: Record<string, string> = {
	"board-gated": "not approved",
	goal: "goal → set",
	memory: "Added to project memory",
	plan: "plan enter",
	"plan-exit": "steps",
	subagent: "Total:",
	todo: "Adding the retry wrapper",
	// The worktree's name survives every clip; the branch is what a narrow terminal shortens.
	worktree: "tool-gallery",
	"worktree-list": "current, clean",
};

/** The package fixtures the budget covers: collapsed, with a result to draw. */
function collapsedFixtures(): ToolFixture[] {
	return FIXTURES.filter(
		(fixture) => fixture.group === "package" && fixture.result !== undefined && fixture.options?.expanded !== true,
	);
}

/**
 * One fixture's block: the call line and the result the transcript draws at that
 * expand state, through the frame that draws it there.
 */
function collapsedBlock(
	frame: any,
	tools: Map<string, any>,
	fixture: ToolFixture,
	width: number,
	expanded = false,
): string[] {
	const name = fixture.tool ?? fixture.name;
	const wrapped = frame(name, () => tools.get(name));
	const isPartial = fixture.options?.isPartial ?? false;
	const args = fixture.args ?? {};
	const call = wrapped.renderCall?.(args, fakeTheme, toolBlockContext({ args, isPartial }));
	const result = wrapped.renderResult?.(
		fixture.result,
		{ expanded, isPartial },
		fakeTheme,
		toolBlockContext({
			args,
			expanded,
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

	test("a folded refusal keeps the instruction the model was handed", () => {
		// The rule is a drawing rule: the block states the verdict, and the result keeps the
		// sentence written for the model. A fold that trimmed both would be a behaviour change.
		const fixture = collapsedFixtures().find((item) => item.name === "board-gated");
		expect(fixture, "the gallery carries a gated-move refusal").toBeDefined();
		const model = (fixture?.result?.content ?? []).map((block: { text?: string }) => block.text ?? "").join(" ");
		expect(model, "the fixture names the route").toContain("session send");

		const { frame, tools } = blockHarness();
		// The frame draws a rail in the indent column; it is punctuation, not the sentence.
		const flatten = (lines: string[]) => lines.join(" ").replace(/╎/g, " ").replace(/\s+/g, " ");
		const drawn = flatten(collapsedBlock(frame, tools, fixture as ToolFixture, BUDGET_WIDTH));
		expect(drawn, "the collapsed block is the verdict").toContain("not approved");
		expect(drawn, "a collapsed block does not print the route").not.toContain("session send");

		const expanded = flatten(collapsedBlock(frame, tools, fixture as ToolFixture, BUDGET_WIDTH, true));
		expect(expanded, "expanding draws the instruction").toContain("session send");
	});

	/** One case per trimmed block, at the three widths the transcript is drawn at. */
	for (const [name, token] of Object.entries(SHAPES)) {
		test(`${name} still says what it is for, at every width`, () => {
			const fixture = collapsedFixtures().find((item) => item.name === name);
			expect(fixture, `${name} is a collapsed package fixture`).toBeDefined();
			const { frame, tools } = blockHarness();
			for (const width of [80, 48, 40]) {
				const lines = collapsedBlock(frame, tools, fixture as ToolFixture, width);
				const shown = lines.join(" ").replace(/╎/g, " ").replace(/\s+/g, " ");
				expect(shown, `${name} at ${width} columns`).toContain(token);
				// The ceiling is measured at the budget's width: a narrow terminal wraps the same
				// facts onto more rows, which is the host's wrap and not a block that grew.
				if (width === BUDGET_WIDTH) {
					expect(lines.length, `${name} at ${width} columns`).toBeLessThanOrEqual(COLLAPSED_ROWS[name] ?? 0);
				}
				for (const line of lines) expect(visibleWidth(line), `${name} at ${width}`).toBeLessThanOrEqual(width);
			}
		});
	}

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

	test("the kit README states the budget this ledger holds", () => {
		// The page a designer reads and the ledger a renderer is measured against are one fact, so the
		// numbers they both quote are held together here, where the ledger is owned: how many blocks the
		// ceiling covers, and which is the tallest. A block added or trimmed moves one of them, and the
		// README is then red rather than quietly out of date. Two integers and one name, never a
		// sentence, so a rewrite that keeps the facts passes.
		const readme = textOf(join(import.meta.dir, "../lib/tui/README.md"));
		const count = /(\d+) blocks/.exec(readme)?.[1];
		const tallest = /`(\w+)` is the tallest at (\d+)/.exec(readme);
		expect(count, "the kit README no longer says how many blocks the ledger covers").toBeDefined();
		expect(tallest, "the kit README no longer names the tallest block").not.toBeNull();
		const ranked = Object.entries(COLLAPSED_ROWS).sort(([, left], [, right]) => right - left);
		expect(Number(count), "the kit README's block count").toBe(ranked.length);
		expect([tallest?.[1], Number(tallest?.[2])], "the kit README's tallest block").toEqual(ranked[0]);
	});
});
