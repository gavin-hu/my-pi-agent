/**
 * The seat's release, through the door a caller meets (#835).
 *
 * A release moves what the caller holds. With `holder` it moves a live peer's claims to the caller
 * instead, and that is the seat's move: the paths go on being held — by the seat — so the peer's own
 * next turn is refused with a conflict that names who holds them, rather than winning a race against
 * a path nobody holds. A release would have left the paths free for anyone in the window.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { LEAD_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { scratchDir } from "../../test/helpers/env.ts";
import type { BusToolSession } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { joinBusSession as joins, busToolSession as session } from "../../test/helpers/fixtures/session-bus-tool.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** The branch a resumed seat has: the mode entry, read the way the runtime reads it. */
const SEAT = [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } }];

/** Two sessions on one bus, the first holding `paths`, and the first's handle. */
async function held(dir: string, seat: readonly unknown[]): Promise<{ gavin: BusToolSession; tom: BusToolSession }> {
	const gavin = session(dir, "/repo/lead", "s1", "gavin", seat);
	const tom = session(dir, "/repo/peer", "s2", "tom");
	await joins(gavin);
	await joins(tom);
	await tom.tool.execute("call", { action: "claim", paths: ["src/a.ts", "src/b.ts"] }, undefined, undefined, tom.ctx);
	return { gavin, tom };
}

describe("the seat takes a peer's claims", () => {
	test("moves them to the seat, and the peer's own claim is refused by name", async () => {
		const { gavin, tom } = await held(scratchDir(temps, "pi-seat-release-"), SEAT);

		const taken = await gavin.tool.execute(
			"call",
			{ action: "release", paths: ["src/a.ts", "src/b.ts"], holder: "tom" },
			undefined,
			undefined,
			gavin.ctx,
		);
		expect(taken.isError).toBeFalsy();
		expect(taken.details.released).toEqual(["src/a.ts", "src/b.ts"]);
		expect(taken.content[0]?.text).toContain("Taken from tom: src/a.ts, src/b.ts");

		// The paths did not become free: they changed hands, so the peer meets a holder by name.
		const again = await tom.tool.execute(
			"call",
			{ action: "claim", paths: ["src/b.ts"] },
			undefined,
			undefined,
			tom.ctx,
		);
		expect(again.details.conflicts).toEqual([{ path: "src/b.ts", owner: "s1", ownerLabel: "gavin" }]);
		expect(again.content[0]?.text).toContain("gavin");
	});

	test("a path the peer never held comes back rather than being created", async () => {
		const { gavin } = await held(scratchDir(temps, "pi-seat-release-"), SEAT);
		const taken = await gavin.tool.execute(
			"call",
			{ action: "release", paths: ["src/a.ts", "lib"], holder: "tom" },
			undefined,
			undefined,
			gavin.ctx,
		);
		expect(taken.details.released).toEqual(["src/a.ts"]);
		expect(taken.details.notOwned).toEqual(["lib"]);
		expect(taken.content[0]?.text).toContain("Not held by tom: lib");
	});

	test("a session with no seat is refused, and the refusal names the door", async () => {
		const { tom } = await held(scratchDir(temps, "pi-seat-release-"), []);
		const refused = await tom.tool.execute(
			"call",
			{ action: "release", paths: ["src/a.ts"], holder: "gavin" },
			undefined,
			undefined,
			tom.ctx,
		);
		expect(refused.isError).toBe(true);
		expect(refused.content[0]?.text).toContain("/board");
	});

	test("naming a session that is not on the bus is an error, not a silent release", async () => {
		const { gavin } = await held(scratchDir(temps, "pi-seat-release-"), SEAT);
		const missing = await gavin.tool.execute(
			"call",
			{ action: "release", paths: ["src/a.ts"], holder: "nobody" },
			undefined,
			undefined,
			gavin.ctx,
		);
		expect(missing.isError).toBe(true);
		expect(missing.content[0]?.text).toContain('no live session labelled "nobody"');
	});
});
