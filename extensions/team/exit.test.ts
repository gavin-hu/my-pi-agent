/**
 * `/team exit` — leaving the team, and the two things that hold a session on it.
 *
 * The leave itself belongs to the bus (`extensions/session-bus/leave.test.ts`), so what this suite
 * owns is the command's order: the refusals are read before the bus is asked, each names the door
 * that frees it, and a session that holds nothing is off the team with the line saying what it gave
 * up. A fake seam is the whole point — a case here would otherwise need a bus, and the bus's own
 * cases already drive one.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { LEAD_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import type { LeaveResult } from "../../lib/session-tool.ts";
import { personActor } from "../../lib/workflow/signs.ts";
import { advance } from "../../test/helpers/board-flow.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { teamCommandHarness } from "../../test/helpers/team.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_760_000_000_000;

/** The command on a board of this suite's, with the leave it records instead of asking a bus. */
const mount = teamCommandHarness(NOW, temps.track);

/** One mounted command, as the seeding helpers below read it. */
type Mounted = ReturnType<typeof mount>;

/** The branch a seated session has: the mode entry, read the way the command reads it. */
const SEAT = [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } }];

/** The leave seam, recording that it was asked and answering what the case says. */
function leaving(answer: LeaveResult) {
	const asked: string[] = [];
	return { asked, leave: { leave: async () => (asked.push("leave"), answer) } };
}

describe("leaving the team", () => {
	test("leaves a session that holds nothing, and names what it gave up", async () => {
		const { asked, leave } = leaving({ ok: true, label: "billing-lead", released: ["src/billing"] });
		const { command, ctx, notifications } = mount({ leave });

		await command.handler("exit", ctx);

		expect(asked).toEqual(["leave"]);
		expect(notifications.at(-1)).toBe(
			"team: billing-lead is off the team — its record is gone and the label is free. Released: src/billing.",
		);
	});

	test("says nothing was given up when there were no claims, and reads it as an ordinary answer", async () => {
		const { leave } = leaving({ ok: true, label: "billing-lead", released: [] });
		const { command, ctx, notifications } = mount({ leave });

		await command.handler("exit", ctx);

		expect(notifications.at(-1)).toBe("team: billing-lead is off the team — its record is gone and the label is free.");
	});

	test("reads a session that was on no bus as nothing to leave, not as a failure", async () => {
		const { leave } = leaving({ ok: true, released: [] });
		const { command, ctx, notifications } = mount({ leave });

		await command.handler("exit", ctx);

		expect(notifications.at(-1)).toBe("team: not on the team — nothing to leave");
	});

	test("a bus that refused says why, and nothing about this session changed", async () => {
		const { leave } = leaving({ ok: false, error: "the session bus did not answer." });
		const { command, ctx, notifications } = mount({ leave });

		await command.handler("exit", ctx);

		expect(notifications.at(-1)).toBe("team: still on the team — the session bus did not answer.");
	});
});

describe("what holds a session on the team", () => {
	/** A card this session holds in `plan`, on the mounted board. */
	async function held(board: Mounted["board"], ctx: Mounted["ctx"]): Promise<string> {
		const store = await board.runtime.store(board.cwd);
		const card = await store.create({ title: "Billing webhook", paths: ["src/billing"] }, { label: "s-lead" }, NOW);
		await advance(store, card.id, "plan", { owner: await board.runtime.who(ctx, board.cwd) }, NOW);
		return card.id;
	}

	/**
	 * A card handed to this session while it holds the seat.
	 *
	 * `claim` is what a seat refuses, so the only way a seated session comes to hold a card is a
	 * handoff from somebody else — the person here — which is the state this case is about.
	 */
	async function handed(board: Mounted["board"], ctx: Mounted["ctx"]): Promise<string> {
		const store = await board.runtime.store(board.cwd);
		const card = await store.create({ title: "Billing webhook", paths: ["src/billing"] }, { label: "s-lead" }, NOW);
		const result = await store.mutate(
			card.id,
			{ kind: "assign", to: await board.runtime.who(ctx, board.cwd) },
			personActor(),
			NOW,
		);
		if (!result.ok) throw new Error(`seeding a handoff to the seat: ${result.error}`);
		return card.id;
	}

	test("refuses while a card is yours, names it, and never asks the bus", async () => {
		const { asked, leave } = leaving({ ok: true, label: "billing-lead", released: [] });
		const { command, ctx, notifications, board } = mount({ leave });
		const id = await held(board, ctx);

		await command.handler("exit", ctx);

		expect(asked).toEqual([]);
		expect(notifications.at(-1)).toBe(
			`team: still on the team — #${id} plan is yours.\n  board release ${id} — with no record, only the lead can take it back.`,
		);
	});

	test("refuses for the page's seat, because the next sign would re-join the session", async () => {
		const { asked, leave } = leaving({ ok: true, label: "billing-lead", released: [] });
		const { command, ctx, notifications } = mount({ leave, branch: SEAT });

		await command.handler("exit", ctx);

		expect(asked).toEqual([]);
		expect(notifications.at(-1)).toBe(
			"team: still on the team — this session is serving the board's page.\n  /board exit — ends the page and the seat together.",
		);
	});

	test("names both when the seat and a card hold it, each with its own door", async () => {
		const { leave } = leaving({ ok: true, label: "billing-lead", released: [] });
		const { command, ctx, notifications, board } = mount({ leave, branch: SEAT });
		const id = await handed(board, ctx);

		await command.handler("exit", ctx);

		const line = notifications.at(-1) ?? "";
		expect(line.split("\n")).toHaveLength(3);
		expect(line).toContain("this session is serving the board's page and");
		expect(line).toContain(`#${id} plan is yours.`);
		expect(line).toContain("/board exit");
		expect(line).toContain(`board release ${id}`);
	});
});
