/**
 * The `board` tool: every action, every refusal, and the state a refusal leaves
 * behind.
 *
 * The tool is driven the way Pi drives it — through the registered tool's
 * `execute` with a fake context — so the cases cover the schema's required fields,
 * the boundary's validation, the details the renderer reads, and the fact that a
 * refused call hands back the card it did not change.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { boardHarness } from "../../test/helpers/board.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { type FakeCtxOptions } from "../../test/helpers/context.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { MAX_NOTES } from "../../lib/board/card.ts";
import type { JoinResult } from "../../lib/session-tool.ts";
import type { TeamJoin } from "./join.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;

/** A team join that records every call and answers with `answer`. */
function recordingTeam(
	answer: () => JoinResult = () => ({ ok: true, label: "billing-lead", watching: { armed: true, wake: false } }),
) {
	const calls: number[] = [];
	const team: TeamJoin = {
		join: async () => {
			calls.push(calls.length + 1);
			return answer();
		},
	};
	return { team, calls };
}

/** A registered tool plus the context it will be called with. */
function harness(options: FakeCtxOptions & { agentDir?: string; team?: TeamJoin } = {}) {
	const { agentDir, team, ...ctxOptions } = options;
	const board = boardHarness({ agentDir, now: NOW, track: temps.track, ...ctxOptions });
	registerTools(board.fake.pi, board.runtime, team === undefined ? {} : { team });
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		tool,
		ctx: board.ctx,
		/** Run one action. */
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
				isError?: boolean;
			};
		},
	};
}

/** The text the model reads. */
function text(result: { content: Array<{ text: string }> }): string {
	return result.content.map((block) => block.text).join("\n");
}

describe("the registration", () => {
	test("declares the surface the tool needs", () => {
		const { tool } = harness();
		expect(tool.name).toBe("board");
		expect(tool.promptSnippet.length).toBeGreaterThan(0);
		expect(tool.promptGuidelines.length).toBeGreaterThan(0);
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
		expect(tool.executionMode).toBe("sequential");
	});

	test("refuses an action it does not have, without throwing", async () => {
		const { call } = harness();
		const result = await call({ action: "archive" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("unknown action");
	});
});

describe("list", () => {
	test("says so when the board is empty", async () => {
		const { call } = harness();
		const result = await call({ action: "list" });
		expect(text(result)).toBe("The board is empty.");
		expect(result.details.cards).toEqual([]);
	});

	test("lists in lane order, with the holder", async () => {
		const { call } = harness();
		const added = await call({ action: "add", title: "Billing webhook accepts orders", paths: ["src/billing"] });
		const id = added.details.card?.id ?? "";
		await call({ action: "claim", card: id });
		const later = await call({ action: "add", title: "Retry branches merge cleanly" });
		expect(later.details.card?.id).toBe("2");
		const result = await call({ action: "list" });
		expect(result.details.cards?.map((card) => card.status)).toEqual(["todo", "doing"]);
		expect(text(result)).toContain("#2 todo · Retry branches merge cleanly · unassigned");
		expect(text(result)).toContain("#1 doing · Billing webhook accepts orders · billing-lead");
	});

	test("shows one card, however the id is written", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One", note: "why it exists" });
		for (const card of ["1", "#1"]) {
			const result = await call({ action: "list", card });
			expect(result.details.card?.id).toBe("1");
			expect(text(result)).toContain("last note (billing-lead): why it exists");
		}
	});

	test("refuses an id that is not a card id, and one that is not there", async () => {
		const { call } = harness();
		expect(text(await call({ action: "list", card: "four" }))).toContain('"four" is not a card id.');
		expect(text(await call({ action: "list", card: "9" }))).toContain("#9 does not exist.");
	});

	test("names an owner who finished, with the count of what it finished", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		await call({ action: "move", card: "1", status: "done" });
		const result = await call({ action: "list", round: true });
		// The group survives its last card finishing, and the line says so plainly
		// instead of leaving a bare "0" next to a teammate who did the work.
		expect(result.details.round?.owners.map((group) => group.label)).toEqual(["billing-lead"]);
		expect(text(result)).toContain("billing-lead (0 live, 1 done)");
	});

	test("filters one lane", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		await call({ action: "claim", card: "2" });
		const result = await call({ action: "list", status: "doing" });
		expect(result.details.cards?.map((card) => card.id)).toEqual(["2"]);
	});

	test("shows only what this session holds, and nothing for one that holds nothing", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead", sessionName: "billing-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer", sessionName: "billing-core" });
		await lead.call({ action: "add", title: "Mine" });
		await lead.call({ action: "add", title: "Theirs" });
		await lead.call({ action: "claim", card: "1" });
		await peer.call({ action: "claim", card: "2" });
		expect((await lead.call({ action: "list", mine: true })).details.cards?.map((card) => card.id)).toEqual(["1"]);
		// The same rule a claim is checked against: a lane filter narrows it, it does not
		// widen it, and a session holding nothing gets an empty list rather than the board.
		expect((await lead.call({ action: "list", mine: true, status: "todo" })).details.cards).toEqual([]);
		const stranger = harness({ cwd, agentDir, sessionId: "s-other", sessionName: "billing-other" });
		expect((await stranger.call({ action: "list", mine: true })).details.cards).toEqual([]);
	});

	test("filters by a query over the title, a path hint, or the holder", async () => {
		const { call } = harness();
		await call({ action: "add", title: "Billing webhook", paths: ["src/billing"] });
		await call({ action: "add", title: "Retry branches", paths: ["src/git"] });
		await call({ action: "claim", card: "2" });
		expect((await call({ action: "list", query: "webhook" })).details.cards?.map((card) => card.id)).toEqual(["1"]);
		expect((await call({ action: "list", query: "src/git" })).details.cards?.map((card) => card.id)).toEqual(["2"]);
		expect((await call({ action: "list", query: "BILLING-LEAD" })).details.cards?.map((card) => card.id)).toEqual([
			"2",
		]);
		expect((await call({ action: "list", query: "nothing here" })).details.cards).toEqual([]);
	});

	test("adds the lead's rollup when asked, over the whole board", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		await call({ action: "claim", card: "2" });
		const result = await call({ action: "list", round: true, status: "todo" });
		expect(result.details.cards?.map((card) => card.id)).toEqual(["1"]);
		expect(result.details.round?.owners.map((group) => group.label)).toEqual(["billing-lead"]);
		expect(result.details.round?.unassigned.map((card) => card.id)).toEqual(["1"]);
		expect(result.details.round?.unplanned.map((card) => card.id)).toEqual(["2"]);
		expect(text(result)).toContain("1 owner · 2 features · 1 unassigned · 1 unplanned");
	});
});

describe("add", () => {
	test("creates a todo card held by nobody, with its first note", async () => {
		const { call } = harness();
		const result = await call({
			action: "add",
			title: "Billing webhook",
			paths: ["src/billing"],
			note: "from the lead",
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.card).toMatchObject({ id: "1", status: "todo", paths: ["src/billing"] });
		expect(result.details.card?.notes).toHaveLength(1);
		expect(result.details.me.label).toBe("billing-lead");
	});

	test("refuses an invalid title, path, or note", async () => {
		const { call } = harness();
		expect(text(await call({ action: "add", title: "  " }))).toContain("title is required.");
		expect(text(await call({ action: "add", title: "T", paths: ["/etc/passwd"] }))).toContain("is absolute");
		expect(text(await call({ action: "add", title: "T", note: "" }))).toContain("text is required.");
	});

	test("takes a priority, which orders its lane", async () => {
		const { call } = harness();
		await call({ action: "add", title: "later" });
		await call({ action: "add", title: "now", priority: "high" });
		const result = await call({ action: "list" });
		expect(result.details.cards?.map((card) => card.id)).toEqual(["2", "1"]);
		expect(text(result)).toContain("#2 todo · now · unassigned · high");
		expect(text(await call({ action: "add", title: "T", priority: "urgent" }))).toContain(
			"priority must be one of high, normal, low.",
		);
	});
});

describe("claim, release, and move", () => {
	test("claim takes the card for this session", async () => {
		const { call, ctx } = harness();
		await call({ action: "add", title: "One" });
		const result = await call({ action: "claim", card: "1" });
		expect(result.details.card).toMatchObject({
			status: "doing",
			owner: { id: ctx.sessionManager.getSessionId(), label: "billing-lead" },
		});
	});

	test("a claim another session made is refused with that session's name", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead", sessionName: "billing-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer", sessionName: "billing-core" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		const result = await lead.call({ action: "claim", card: "1" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("#1 is held by billing-core.");
		expect(result.details.card?.owner?.label).toBe("billing-core");
	});

	test("release returns it to todo with no owner left", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		const result = await call({ action: "release", card: "1" });
		expect(result.details.card?.status).toBe("todo");
		expect(result.details.card?.owner).toBeUndefined();
	});

	test("move changes lane, and refuses a target it cannot reach", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		expect((await call({ action: "move", card: "1", status: "blocked" })).details.card?.status).toBe("blocked");
		expect(text(await call({ action: "move", card: "1", status: "todo" }))).toContain("Use release");
		expect(text(await call({ action: "move", card: "1" }))).toContain("move needs a target lane");
	});

	test("every card action needs a card", async () => {
		const { call } = harness();
		for (const action of ["claim", "release", "reclaim", "move", "note", "plan", "drop"]) {
			expect(text(await call({ action })), action).toContain("card is required");
		}
		expect(text(await call({ action: "edit", title: "T" }))).toContain("card is required");
	});

	test("reclaim takes the card back from whoever holds it, and keeps its notes", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead", sessionName: "billing-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer", sessionName: "billing-core" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await peer.call({ action: "note", card: "1", text: "half done" });
		const result = await lead.call({ action: "reclaim", card: "1" });
		expect(result.details.card).toMatchObject({ status: "todo", by: "billing-lead" });
		expect(result.details.card?.owner).toBeUndefined();
		expect(result.details.card?.notes.map((note) => note.text)).toEqual(["half done"]);
	});
});

describe("edit and the links between cards", () => {
	test("fixes a title and a path hint anyone can reach while nobody holds it", async () => {
		const { call } = harness();
		await call({ action: "add", title: "Billing webhok" });
		const result = await call({ action: "edit", card: "1", title: "Billing webhook", paths: ["src/billing"] });
		expect(result.details.card).toMatchObject({ title: "Billing webhook", paths: ["src/billing"] });
		expect(text(result)).toContain("#1 todo · Billing webhook");
	});

	test("refuses an edit with nothing to change, and one another session holds", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead", sessionName: "billing-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer", sessionName: "billing-core" });
		await lead.call({ action: "add", title: "One" });
		expect(text(await lead.call({ action: "edit", card: "1" }))).toContain(
			"edit needs a title, paths, priority, or dependsOn.",
		);
		await peer.call({ action: "claim", card: "1" });
		const refused = await lead.call({ action: "edit", card: "1", title: "mine now" });
		expect(refused.isError).toBe(true);
		expect(text(refused)).toContain("#1 is held by billing-core. Only its owner can edit it.");
		expect(refused.details.card?.title).toBe("One");
	});

	test("records what a card waits for, and refuses the claim until that lands", async () => {
		const { call } = harness();
		await call({ action: "add", title: "Retry branches" });
		await call({ action: "add", title: "Billing webhook" });
		const linked = await call({ action: "edit", card: "2", dependsOn: ["1"] });
		expect(linked.details.card?.dependsOn).toEqual(["1"]);
		// The dependency is named; its lane is `list`'s to add, because the edit answer
		// does not read the whole board.
		expect(text(linked)).toContain("waits on: #1");
		expect(text(await call({ action: "list", card: "2" }))).toContain("waits on: #1 (todo)");
		const refused = await call({ action: "claim", card: "2" });
		expect(refused.isError).toBe(true);
		expect(text(refused)).toContain("#2 waits on #1 (todo).");
		await call({ action: "claim", card: "1" });
		await call({ action: "move", card: "1", status: "done" });
		expect((await call({ action: "claim", card: "2" })).details.card?.status).toBe("doing");
	});

	test("refuses a link to a card that is not there, to itself, and around a loop", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		expect(text(await call({ action: "edit", card: "1", dependsOn: ["9"] }))).toContain("#9 does not exist.");
		expect(text(await call({ action: "edit", card: "1", dependsOn: ["1"] }))).toContain("#1 cannot wait on itself.");
		await call({ action: "edit", card: "2", dependsOn: ["1"] });
		expect(text(await call({ action: "edit", card: "1", dependsOn: ["2"] }))).toContain(
			"#1 cannot wait on #2: that would make a loop.",
		);
	});

	test("refuses to drop a card another one waits on", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		await call({ action: "edit", card: "2", dependsOn: ["1"] });
		const refused = await call({ action: "drop", card: "1" });
		expect(refused.isError).toBe(true);
		expect(text(refused)).toContain("#1 is waited on by #2; drop that card first.");
	});
});

describe("note and plan", () => {
	test("note appends, and the oldest drop past the cap", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		for (let index = 0; index < MAX_NOTES + 1; index++)
			await call({ action: "note", card: "1", text: `note ${index}` });
		const result = await call({ action: "note", card: "1", text: "last" });
		expect(result.details.card?.notes).toHaveLength(MAX_NOTES);
		expect(result.details.card?.notesDropped).toBe(2);
	});

	test("plan records the file, and only the owner may", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead", sessionName: "billing-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer", sessionName: "billing-core" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		expect(text(await lead.call({ action: "plan", card: "1", path: "p.md" }))).toContain(
			"Only its owner records a plan.",
		);
		const result = await peer.call({ action: "plan", card: "1", path: "~/.pi/agent/plans/k/one.md" });
		expect(result.details.card?.plan).toBe("~/.pi/agent/plans/k/one.md");
	});
});

describe("drop", () => {
	test("removes a todo card and reports the id", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		const result = await call({ action: "drop", card: "1" });
		expect(result.details.dropped).toBe("1");
		expect(text(result)).toBe("#1 dropped, with its notes.");
	});

	test("refuses a live card another session holds", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead", sessionName: "billing-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer", sessionName: "billing-core" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		const result = await lead.call({ action: "drop", card: "1" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("cannot be dropped while someone holds it");
		expect(result.details.card?.id).toBe("1");
	});
});

describe("the details a refusal carries", () => {
	test("name the action and keep the card, so a retry starts from the truth", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		const refused = await call({ action: "claim", card: "1" });
		expect(refused.isError).toBeFalsy();
		// Claiming what you already hold is a no-op, not a failure.
		expect(refused.details.card?.rev).toBe(2);
	});
});

describe("the team", () => {
	test("a card write joins once, and a second write does not ask again", async () => {
		const { team, calls } = recordingTeam();
		const { call } = harness({ team });
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		expect(calls).toHaveLength(1);
	});

	test("a read never joins: looking at the board is not joining it", async () => {
		const { team, calls } = recordingTeam();
		const { call } = harness({ team });
		await call({ action: "list" });
		await call({ action: "list", round: true });
		expect(calls).toEqual([]);
	});

	test("a refused join leaves the board working, and the next write asks again", async () => {
		const { team, calls } = recordingTeam(() => ({ ok: false, error: "the session bus is not loaded" }));
		const { call } = harness({ team });
		const added = await call({ action: "add", title: "One" });
		expect(added.isError).toBeFalsy();
		expect(added.details.card?.id).toBe("1");
		await call({ action: "claim", card: "1" });
		expect(calls).toHaveLength(2);
	});
});
