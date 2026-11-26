/**
 * Who a board call writes as: the name on the card, and the id the card keeps.
 *
 * Split out of `session.test.ts` when that suite reached its height: the answers here are one
 * question, asked in order — the seat, the record, the team's free name, the id's tail — and the
 * record half now has a second row to consider, the one a `/new` keeps (#915).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { openSession, projectWithTeam, recordOnBus } from "../../test/helpers/board-session.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { agentLabel } from "../session-label.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("who", () => {
	const agentDir = temps.track(tempDir("pi-agent-"));

	test("draws the default team's first free name, not the user's own name", async () => {
		const runtime = openSession(agentDir);
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1", sessionName: "billing-core" });
		// Pi's session name is the user's, and a rename must not move a card's owner: the draw names the
		// session from the loader's default team — `gavin` is the lead's own name, so `tom` is free — and
		// the same call answers the same word every time.
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "tom" });
		expect((await runtime.who(ctx, "/repo/billing")).label).toBe("tom");
	});

	test("writes as the label the bus already holds for this session", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		// `/team join core-claims` names the session on the bus, so its cards, its notes, and
		// the join a claim makes are all that one word rather than a name derived past it.
		await recordOnBus(runtime, "/repo/billing", { id: "s-1", label: "core-claims" });
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "core-claims" });
	});

	test("writes as the record this process serves, not the id a `/new` gave it", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")), 4_242);
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "after-a-new" });
		// A reset keeps the record (#915), so the row is the one the previous transcript wrote, under
		// the id that one had: its name is what a peer addresses and what its card is owned by.
		await recordOnBus(runtime, "/repo/billing", { id: "before-a-new", label: "core-claims", pid: 4_242 });
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "before-a-new", label: "core-claims" });
	});

	test("prefers the record its own id names, so a session that did not reset is named as before", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")), 4_242);
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		await recordOnBus(runtime, "/repo/billing", { id: "s-1", label: "mine", pid: 4_242 });
		await recordOnBus(runtime, "/repo/billing", { id: "s-older", label: "theirs", pid: 4_242 });
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "mine" });
	});

	test("ignores a row this machine did not write, whose pid may coincide", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")), 4_242);
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "after-a-new" });
		// A replicated bus: the record names the other machine, so the number in it is not a local
		// process and the row is not this session's to serve.
		await recordOnBus(runtime, "/repo/billing", {
			id: "elsewhere",
			label: "peer",
			pid: 4_242,
			host: "ffffffffffffffff",
		});
		expect((await runtime.who(ctx, "/repo/billing")).id).toBe("after-a-new");
	});

	test("ignores a row another process wrote in the same name", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")), 4_242);
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "after-a-new" });
		// A session that never reset is named by its own id, whatever else the bus holds.
		await recordOnBus(runtime, "/repo/billing", { id: "s-2", label: "peer", pid: 999 });
		expect((await runtime.who(ctx, "/repo/billing")).id).toBe("after-a-new");
	});

	test("draws from the team when the record is somebody else's, or blank", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		await recordOnBus(runtime, "/repo/billing", { id: "s-2", label: "core-claims" });
		expect((await runtime.who(ctx, "/repo/billing")).label).toBe("tom");
		// A label is text from a file, so it is flattened and capped like any other: an empty
		// one names like no record at all instead of leaving a blank chip.
		await recordOnBus(runtime, "/repo/billing", { id: "s-1", label: "" });
		expect((await runtime.who(ctx, "/repo/billing")).label).toBe("tom");
	});

	test("names a session with no record from the first team.teammates name nobody holds", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = openSession(agentDir);
		const cwd = projectWithTeam(temps.track, ["gavin", "tom", "sam"], "gavin");
		// `gavin` is the lead's own name and `tom` a record's, so `sam` is the first this session may
		// take: the readable word the project already chose, not its id's tail.
		await recordOnBus(runtime, cwd, { id: "s-2", label: "tom" });
		const { ctx } = fakeCtx({ cwd, sessionId: "s-1" });
		expect(await runtime.who(ctx, cwd)).toEqual({ id: "s-1", label: "sam" });
	});

	test("falls back to the id when the team can give no free name", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const runtime = openSession(agentDir);
		// Two ways a list gives nothing: it names only the lead, and every name it names is held.
		for (const [names, held] of [
			[["gavin"], []],
			[
				["tom", "sam"],
				["tom", "sam"],
			],
		] as const) {
			const cwd = projectWithTeam(temps.track, names, "gavin");
			for (const label of held) await recordOnBus(runtime, cwd, { id: `s-${label}`, label });
			const { ctx } = fakeCtx({ cwd, sessionId: "s-1" });
			expect((await runtime.who(ctx, cwd)).label).toBe(agentLabel("s-1"));
		}
	});

	test("names it as the seat while it serves the page, and as itself again after", async () => {
		const runtime = openSession(temps.track(tempDir("pi-agent-")));
		const { ctx } = fakeCtx({ cwd: "/repo/billing", sessionId: "s-1" });
		await recordOnBus(runtime, "/repo/billing", { id: "s-1", label: "core-claims" });
		expect(runtime.serving()).toBeUndefined();
		runtime.serve("team-lead");
		expect(runtime.serving()).toBe("team-lead");
		// The page a session serves is a role, so it outranks the name the team gave it.
		expect(await runtime.who(ctx, "/repo/billing")).toEqual({ id: "s-1", label: "team-lead" });
		runtime.serve(undefined);
		expect((await runtime.who(ctx, "/repo/billing")).label).toBe("core-claims");
	});

	test("keeps the readable chain for a host that reports no id", async () => {
		const runtime = openSession(agentDir);
		const named = fakeCtx({ cwd: "/repo/billing", sessionId: "", sessionName: "billing-core" });
		expect((await runtime.who(named.ctx, "/repo/billing")).label).toBe("billing-core");
		const anonymous = fakeCtx({ cwd: "/repo/billing", sessionId: "" });
		const who = await runtime.who(anonymous.ctx, "/repo/billing");
		expect(who.id).toBeUndefined();
		expect(who.label).toBe("billing");
	});
});
