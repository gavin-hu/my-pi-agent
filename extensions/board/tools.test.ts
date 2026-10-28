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
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { advance } from "../../test/helpers/board-flow.ts";
import { boardHarness } from "../../test/helpers/board.ts";
import type { FakePiOptions } from "../../test/helpers/fakes.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { type FakeCtxOptions } from "../../test/helpers/context.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { agentLabel } from "../../lib/session-label.ts";
import { MAX_NOTES } from "../../lib/board/card.ts";
import type { JoinResult } from "../../lib/session-tool.ts";
import type { TeamJoin } from "./join.ts";
import { registerTools } from "./tools.ts";
import { ACTION_FIELDS, BOARD_ACTION_DOCS, BOARD_ACTIONS, type BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;

/** The two sessions these suites work as, and the team names their ids derive. */
const LEAD_ID = "s-lead";
const PEER_ID = "s-peer";
const LEAD = agentLabel(LEAD_ID);
const PEER = agentLabel(PEER_ID);

/** A team join that records every call and the label it asked for, and answers with `answer`. */
function recordingTeam(
	answer: () => JoinResult = () => ({ ok: true, label: LEAD, watching: { armed: true, wake: false } }),
) {
	const calls: number[] = [];
	const labels: Array<string | undefined> = [];
	const team: TeamJoin = {
		join: async (_ctx, input) => {
			calls.push(calls.length + 1);
			labels.push(input?.label);
			return answer();
		},
	};
	return { team, calls, labels };
}

/** A registered tool plus the context it will be called with. */
function harness(options: FakeCtxOptions & { agentDir?: string; team?: TeamJoin; exec?: FakePiOptions["exec"] } = {}) {
	const { agentDir, team, exec, ...ctxOptions } = options;
	const board = boardHarness({ agentDir, exec, now: NOW, track: temps.track, ...ctxOptions });
	registerTools(board.fake.pi, board.runtime, team === undefined ? {} : { team });
	const tool = board.fake.pi.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	return {
		tool,
		ctx: board.ctx,
		runtime: board.runtime,
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

/** The session a harness writes as, and the reviewer a fixture uses for the gates. */
const REVIEWER = { id: "s-reviewer", label: "reviewer" };

/**
 * Take a card to a lane through the gates, for a case that is not about the gates.
 *
 * The tool's own calls cannot do it: approving a contract and spot-checking work are refused
 * to the session holding the card, so a fixture that reaches `done` needs a second one.
 */
async function seed(
	board: { runtime: ReturnType<typeof harness>["runtime"]; ctx: ReturnType<typeof harness>["ctx"] },
	id: string,
	lane: "plan" | "execute" | "blocked" | "done",
): Promise<void> {
	const store = await board.runtime.store(board.ctx.cwd);
	const me = board.runtime.who(board.ctx, board.ctx.cwd);
	await advance(store, id, lane, { owner: me, reviewer: REVIEWER }, NOW);
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

	test("states every verb once, from the table that owns them", () => {
		const { tool } = harness();
		// A new action without a row here would reach the model as a bare name.
		expect(Object.keys(BOARD_ACTION_DOCS).sort()).toEqual([...BOARD_ACTIONS].sort());
		for (const action of BOARD_ACTIONS) {
			expect(BOARD_ACTION_DOCS[action].length, action).toBeGreaterThan(0);
			expect(tool.description, action).toContain(`\`${action}\` `);
			// The parameter says which verbs are reads and points at the description
			// instead of restating ten meanings a second time.
			expect(tool.parameters.properties.action.description).toContain("`list` reads the board");
			expect(tool.promptSnippet).toContain(action);
		}
	});

	test("refuses an action it does not have, without throwing", async () => {
		const { call } = harness();
		const result = await call({ action: "reopen" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("unknown action");
	});
});

describe("a field the action does not act on", () => {
	test("is refused, naming the action that takes it, and writes nothing", async () => {
		const { call } = harness();
		// `add` used to accept this and drop it: the caller could not tell a recorded
		// link from an ignored one, and the card was written without it.
		const result = await call({ action: "add", title: "Export orders as CSV", dependsOn: ["31"] });
		expect(result.isError).toBe(true);
		expect(result.details.error).toBe("add does not act on dependsOn: `edit` takes it.");
		expect(text(await call({ action: "list" }))).toBe("The board is empty.");
	});

	test("names every stray field and the verb that takes each", async () => {
		const { call } = harness();
		const result = await call({ action: "add", title: "x", dependsOn: ["1"], text: "why" });
		expect(result.details.error).toBe(
			"add does not act on dependsOn, text: `edit` takes dependsOn; `note` takes text.",
		);
		// Two actions take this one, so the message has to name both and say "take".
		const lane = await call({ action: "add", title: "x", lane: "execute" });
		expect(lane.details.error).toBe("add does not act on lane: `list` and `move` take it.");
	});

	test("does not reach for the board, so a refused call enlists nobody", async () => {
		const { team, calls } = recordingTeam();
		const { call } = harness({ team });
		await call({ action: "add", title: "x", dependsOn: ["1"] });
		expect(calls).toEqual([]);
	});

	test("leaves a field the action does read alone", async () => {
		const { call } = harness();
		// The shapes that would break first if the table were too eager: `list` reads a
		// card, and `move` reads a card and a lane.
		const added = await call({ action: "add", title: "Retry the gateway", paths: ["src/gateway"] });
		const id = added.details.card?.id ?? "";
		expect(text(await call({ action: "list", card: id }))).toContain("Retry the gateway");
		expect(text(await call({ action: "claim", card: id }))).toContain("Retry the gateway");
		expect(text(await call({ action: "move", card: id, lane: "blocked", blocker: "decision" }))).toContain("blocked");
		// And a note is `add`'s, not `note`'s.
		expect(text(await call({ action: "add", title: "Second", note: "from the thread" }))).toContain("Second");
	});

	test("publishes no field that no action acts on, and invents none", () => {
		const { tool } = harness();
		const published = Object.keys(tool.parameters.properties).filter((field) => field !== "action");
		const claimed = new Set(Object.values(ACTION_FIELDS).flat());
		// A new parameter with no owner is the same defect one step along: published to
		// every action, acted on by some action, silently dropped by the rest.
		expect(published.filter((field) => !claimed.has(field))).toEqual([]);
		expect([...claimed].filter((field) => !published.includes(field))).toEqual([]);
	});
});

describe("list", () => {
	test("says so when the board is empty", async () => {
		const { call } = harness();
		const result = await call({ action: "list" });
		expect(text(result)).toBe("The board is empty.");
		expect(result.details.cards).toEqual([]);
	});

	test("names a card file it cannot read, instead of calling the board empty", async () => {
		const agentDir = temps.track(tempDir("pi-agent-"));
		const { call, ctx, runtime } = harness({ agentDir });
		// A board written by a newer build: its file is there, and this build refuses it.
		const store = await runtime.store(ctx.cwd);
		await store.ensure();
		writeFileSync(join(store.dir, "cards", "0007.json"), JSON.stringify({ v: 3, id: "7", title: "Newer" }));

		const listed = await call({ action: "list" });
		expect(text(listed)).toContain("1 file this build cannot read: 0007.json (version 3)");
		const missing = await call({ action: "list", card: "7" });
		expect(missing.isError).toBe(true);
		expect(text(missing)).toContain("#7 is there and this build cannot read it (0007.json: version 3)");
	});

	test("lists in lane order, with the holder", async () => {
		const { call } = harness();
		const added = await call({ action: "add", title: "Billing webhook accepts orders", paths: ["src/billing"] });
		const id = added.details.card?.id ?? "";
		await call({ action: "claim", card: id });
		const later = await call({ action: "add", title: "Retry branches merge cleanly" });
		expect(later.details.card?.id).toBe("2");
		const result = await call({ action: "list" });
		expect(result.details.cards?.map((card) => card.lane)).toEqual(["backlog", "plan"]);
		expect(text(result)).toContain("#2 backlog · Retry branches merge cleanly · unassigned");
		expect(text(result)).toContain(`#1 plan · Billing webhook accepts orders · ${LEAD}`);
	});

	test("shows one card, however the id is written", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One", note: "why it exists" });
		for (const card of ["1", "#1"]) {
			const result = await call({ action: "list", card });
			expect(result.details.card?.id).toBe("1");
			expect(text(result)).toContain(`last note (${LEAD}): why it exists`);
		}
	});

	test("refuses an id that is not a card id, and one that is not there", async () => {
		const { call } = harness();
		expect(text(await call({ action: "list", card: "four" }))).toContain('"four" is not a card id.');
		expect(text(await call({ action: "list", card: "9" }))).toContain("#9 does not exist.");
	});

	test("names an owner who finished, with the count of what it finished", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "One" });
		await seed(board, "1", "done");
		const result = await call({ action: "list", round: true });
		// The group survives its last card finishing, and the line says so plainly
		// instead of leaving a bare "0" next to a teammate who did the work.
		expect(result.details.round?.owners.map((group) => group.label)).toEqual([LEAD]);
		expect(text(result)).toContain(`${LEAD} (0 live, 1 done)`);
	});

	test("filters one lane", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		await call({ action: "claim", card: "2" });
		const result = await call({ action: "list", lane: "plan" });
		expect(result.details.cards?.map((card) => card.id)).toEqual(["2"]);
	});

	test("shows only what this session holds, and nothing for one that holds nothing", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "Mine" });
		await lead.call({ action: "add", title: "Theirs" });
		await lead.call({ action: "claim", card: "1" });
		await peer.call({ action: "claim", card: "2" });
		expect((await lead.call({ action: "list", mine: true })).details.cards?.map((card) => card.id)).toEqual(["1"]);
		// The same rule a claim is checked against: a lane filter narrows it, it does not
		// widen it, and a session holding nothing gets an empty list rather than the board.
		expect((await lead.call({ action: "list", mine: true, lane: "backlog" })).details.cards).toEqual([]);
		const stranger = harness({ cwd, agentDir, sessionId: "s-other" });
		expect((await stranger.call({ action: "list", mine: true })).details.cards).toEqual([]);
	});

	test("filters by a query over the title, the holder, a path hint, the plan, or a note", async () => {
		const { call } = harness();
		await call({ action: "add", title: "Billing webhook", paths: ["src/billing"] });
		await call({ action: "add", title: "Retry branches", paths: ["src/git"] });
		await call({ action: "claim", card: "2" });
		await call({
			action: "contract",
			card: "2",
			path: "~/.pi/agent/plans/8872d3adda0e/retry-branches.md",
			goal: "g",
			acceptance: "a",
			scopeOut: "s",
		});
		await call({ action: "note", card: "1", text: "waiting on the gateway owner" });
		const ids = async (query: string) => (await call({ action: "list", query })).details.cards?.map((card) => card.id);
		expect(await ids("webhook")).toEqual(["1"]);
		expect(await ids("src/git")).toEqual(["2"]);
		expect(await ids(LEAD.toUpperCase())).toEqual(["2"]);
		// The two fields that hold a card's reasoning are two it can be found by.
		expect(await ids("gateway owner")).toEqual(["1"]);
		expect(await ids("retry-branches")).toEqual(["2"]);
		expect(await ids("nothing here")).toEqual([]);
	});

	test("leaves the finished cards out of a plain listing, and says how many", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "Open one" });
		await call({ action: "add", title: "Finished one" });
		await seed(board, "2", "done");
		const result = await call({ action: "list" });
		// A finished card is history, not work: it is not in the rows, and the count is what
		// stops the listing from reading as a one-card board.
		expect(result.details.cards?.map((card) => card.id)).toEqual(["1"]);
		expect(text(result)).toContain("#1 backlog · Open one");
		expect(text(result)).not.toContain("Finished one");
		expect(text(result)).toContain('1 done card hidden; pass lane: "done" to read it.');
		// The escape is the lane that names it, and it lists nothing else.
		const finished = await call({ action: "list", lane: "done" });
		expect(finished.details.cards?.map((card) => card.id)).toEqual(["2"]);
		expect(text(finished)).toContain("#2 done · Finished one");
		expect(text(finished)).not.toContain("hidden");
	});

	test("reads a board that is all finished as no open cards, and a query alone hides them", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "Finished one" });
		await seed(board, "1", "done");
		const all = await call({ action: "list" });
		expect(text(all)).toBe('No open cards.\n1 done card hidden; pass lane: "done" to read it.');
		// A query narrows the listing, it does not widen it past the lane rule: the card it
		// would have matched is one the listing left out, and the count says so.
		const queried = await call({ action: "list", query: "Finished" });
		expect(queried.details.cards).toEqual([]);
		expect(text(queried)).toContain("1 done card hidden");
		// An empty board says only that.
		const empty = harness();
		expect(text(await empty.call({ action: "list" }))).toBe("The board is empty.");
	});

	test("the round still counts the finished cards a listing leaves out", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "Open one" });
		await call({ action: "add", title: "Finished one" });
		await seed(board, "2", "done");
		const result = await call({ action: "list", round: true });
		expect(result.details.round?.done.map((card) => card.id)).toEqual(["2"]);
		expect(text(result)).toContain("2 features");
	});

	test("adds the lead's rollup when asked, over the whole board", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		await call({ action: "claim", card: "2" });
		const result = await call({ action: "list", round: true, lane: "backlog" });
		expect(result.details.cards?.map((card) => card.id)).toEqual(["1"]);
		expect(result.details.round?.owners.map((group) => group.label)).toEqual([LEAD]);
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
		expect(result.details.card).toMatchObject({ id: "1", lane: "backlog", paths: ["src/billing"] });
		expect(result.details.card?.notes).toHaveLength(1);
		expect(result.details.me.label).toBe(LEAD);
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
		expect(text(result)).toContain("#2 backlog · now · unassigned · high");
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
			lane: "plan",
			owner: { id: ctx.sessionManager.getSessionId(), label: LEAD },
		});
	});

	test("a claim another session made is refused with that session's name", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		const result = await lead.call({ action: "claim", card: "1" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain(`#1 is held by ${PEER}.`);
		expect(result.details.card?.owner?.label).toBe(PEER);
	});

	test("release returns it to the pool with no owner left", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		const result = await call({ action: "release", card: "1" });
		expect(result.details.card?.lane).toBe("backlog");
		expect(result.details.card?.owner).toBeUndefined();
	});

	test("move changes lane, and refuses a target it cannot reach", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		expect((await call({ action: "move", card: "1", lane: "blocked", blocker: "decision" })).details.card?.lane).toBe(
			"blocked",
		);
		expect(text(await call({ action: "move", card: "1", lane: "backlog" }))).toContain("release it instead");
		expect(text(await call({ action: "move", card: "1" }))).toContain("move needs a target lane");
	});

	test("a finished card's line names the commit, and a blocked card's names its reason", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "Blocked one" });
		await call({ action: "add", title: "Finished one" });
		await call({ action: "claim", card: "1" });
		await call({ action: "move", card: "1", lane: "blocked", blocker: "decision", blockedBy: "legal has to sign" });
		await seed(board, "2", "done");
		const listing = text(await call({ action: "list" }));
		expect(listing).toContain("blocked: legal has to sign");
		// A plain listing leaves the finished card out, so its line is read from the lane
		// that asks for it. No repository behind this harness, so it names no commit: the
		// silence is the honest answer, not a word saying "none".
		const finished = text(await call({ action: "list", lane: "done" }));
		expect(finished).toContain(`#2 done · Finished one · ${LEAD}`);
		expect(finished).not.toContain("landed");
	});

	test("a block records what it waits on, and the listing says so", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		const blocked = await call({
			action: "move",
			card: "1",
			lane: "blocked",
			blocker: "decision",
			blockedBy: "legal has to sign",
		});
		expect(blocked.details.card?.blocked).toEqual({ kind: "decision", note: "legal has to sign" });
		// One line, the sentence with its kind beside it: the kind is what decides where the
		// card goes back to, so a reader never has to open it to find out.
		expect(text(blocked)).toContain("blocked: legal has to sign (decision)");
		expect(text(await call({ action: "list" }))).toContain("blocked: legal has to sign (decision)");
		// Releasing keeps the block: the decision is still pending, whoever holds the card.
		expect((await call({ action: "release", card: "1" })).details.card?.blocked).toEqual({
			kind: "decision",
			note: "legal has to sign",
		});
	});

	test("a move to done records the commit it landed as, when the directory has one", async () => {
		const cwd = temps.track(await makeRepo("pi-board-landed-"));
		// A real repository: the board keys on it, and a move to done can ask git what closed it.
		const board = harness({
			cwd,
			exec: async (command: string, args: string[], options?: { cwd?: string }) => {
				const result = await execP(command, args, { cwd: options?.cwd });
				return { stdout: result.stdout, stderr: result.stderr, code: result.code };
			},
		});
		const { call } = board;
		await call({ action: "add", title: "One" });
		// The gates are not what this case is about, so a seed walks them; the move itself is
		// still the tool's, because the commit it records is the tool's git read.
		await seed(board, "1", "execute");
		const store = await board.runtime.store(board.ctx.cwd);
		await store.mutate("1", { kind: "review" }, REVIEWER, NOW);
		const done = await call({ action: "move", card: "1", lane: "done" });
		const commit = done.details.card?.landed?.commit ?? "";
		expect(commit).toMatch(/^[0-9a-f]{7}$/);
		expect(text(done)).toContain(`landed: ${commit}`);
		expect(text(await call({ action: "list", lane: "done" }))).toContain(`landed ${commit}`);
	});

	test("a move to done outside a repository finishes the card without a commit", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "One" });
		await seed(board, "1", "execute");
		const store = await board.runtime.store(board.ctx.cwd);
		await store.mutate("1", { kind: "review" }, REVIEWER, NOW);
		const done = await call({ action: "move", card: "1", lane: "done" });
		expect(done.details.card?.lane).toBe("done");
		expect(done.details.card?.landed).toBeUndefined();
	});

	test("every card action needs a card", async () => {
		const { call } = harness();
		for (const action of ["claim", "release", "reclaim", "move", "note", "contract", "approve", "review", "drop"]) {
			expect(text(await call({ action })), action).toContain("card is required");
		}
		expect(text(await call({ action: "edit", title: "T" }))).toContain("card is required");
	});

	test("reclaim takes the card back from whoever holds it, and keeps its notes", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await peer.call({ action: "note", card: "1", text: "half done" });
		const result = await lead.call({ action: "reclaim", card: "1" });
		expect(result.details.card).toMatchObject({ lane: "backlog", by: LEAD });
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
		expect(text(result)).toContain("#1 backlog · Billing webhook");
	});

	test("refuses an edit with nothing to change, and one another session holds", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "One" });
		expect(text(await lead.call({ action: "edit", card: "1" }))).toContain(
			"edit needs a title, paths, priority, or dependsOn.",
		);
		await peer.call({ action: "claim", card: "1" });
		const refused = await lead.call({ action: "edit", card: "1", title: "mine now" });
		expect(refused.isError).toBe(true);
		expect(text(refused)).toContain(`#1 is held by ${PEER}. Only its owner can edit it.`);
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
		expect(text(await call({ action: "list", card: "2" }))).toContain("waits on: #1 (backlog)");
		// The blocker's own answer names what it holds up, which is the half a card cannot say
		// about itself: it is the cost of leaving #1 undone.
		expect(text(await call({ action: "list", card: "1" }))).toContain("waited on by 1 card: #2 (backlog)");
		await call({ action: "add", title: "Third" });
		await call({ action: "edit", card: "3", dependsOn: ["1"] });
		expect(text(await call({ action: "list", card: "1" }))).toContain(
			"waited on by 2 cards: #2 (backlog), #3 (backlog)",
		);
		const refused = await call({ action: "claim", card: "2" });
		expect(refused.isError).toBe(true);
		expect(text(refused)).toContain("#2 waits on #1 (backlog).");
		const board = harness({ cwd: tempDir("pi-repo-") });
		await board.call({ action: "add", title: "Retry branches" });
		await board.call({ action: "add", title: "Billing webhook" });
		await board.call({ action: "edit", card: "2", dependsOn: ["1"] });
		await seed(board, "1", "done");
		expect((await board.call({ action: "claim", card: "2" })).details.card?.lane).toBe("plan");
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

	test("says when a card was offered and nobody took it", async () => {
		const { call, runtime, ctx } = harness();
		const added = await call({ action: "add", title: "Retry branches" });
		const id = added.details.card?.id ?? "";
		// The offer is `team`'s verb, written by the rules: seed it where a lead's offer would
		// leave it, and read the card back through the tool.
		const store = await runtime.store(ctx.cwd);
		await store.mutate(id, { kind: "offer" }, { label: "billing-lead" }, 55_000);
		expect(text(await call({ action: "list", card: id }))).toContain("offered: 1m ago, and nobody took it");
		// A claim answers it, so the line goes with the record.
		await call({ action: "claim", card: id });
		expect(text(await call({ action: "list", card: id }))).not.toContain("offered:");
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
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		expect(
			text(await lead.call({ action: "contract", card: "1", path: "p.md", goal: "g", acceptance: "a", scopeOut: "s" })),
		).toContain("Only its owner records a plan.");
		const result = await peer.call({
			action: "contract",
			card: "1",
			path: "~/.pi/agent/plans/k/one.md",
			goal: "g",
			acceptance: "a",
			scopeOut: "s",
		});
		expect(result.details.card?.planPath).toBe("~/.pi/agent/plans/k/one.md");
	});
});

describe("the flow: contract, approval, spot-check", () => {
	test("writes the plan file and the three lines in one call", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		const result = await call({
			action: "contract",
			card: "1",
			path: "plans/one.md",
			goal: "An order is stored once",
			acceptance: "A retry leaves one order",
			scopeOut: "No refunds",
		});
		expect(result.isError).toBeFalsy();
		expect(result.details.card?.contract).toEqual({
			goal: "An order is stored once",
			acceptance: "A retry leaves one order",
			scopeOut: "No refunds",
		});
		expect(text(result)).toContain("plan: plans/one.md");
		expect(text(result)).toContain("approved: nobody yet");
	});

	test("refuses a contract call that names nothing, and a line past its cap", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		expect(text(await call({ action: "contract", card: "1" }))).toBe(
			"Error: contract needs a path, a goal, an acceptance, or a scopeOut.",
		);
		expect(text(await call({ action: "contract", card: "1", goal: "x".repeat(401) }))).toBe(
			"Error: goal must be at most 400 characters.",
		);
	});

	test("execute is refused until a session that does not hold the card approves", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await peer.call({ action: "contract", card: "1", goal: "g", acceptance: "a", scopeOut: "s" });
		// The holder cannot approve its own wording, and the move is refused before it.
		expect(text(await peer.call({ action: "approve", card: "1" }))).toContain(
			"Its contract is approved by a session that does not hold it.",
		);
		expect(text(await peer.call({ action: "move", card: "1", lane: "execute" }))).toContain("is not approved yet");
		const approved = await lead.call({ action: "approve", card: "1" });
		expect(approved.details.card?.contract?.approved?.by).toBe(LEAD);
		expect(text(await peer.call({ action: "move", card: "1", lane: "execute" }))).toContain("#1 execute");
	});

	test("done is refused until somebody else spot-checks the work", async () => {
		const cwd = temps.track(tempDir("pi-repo-"));
		const agentDir = temps.track(tempDir("pi-agent-"));
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		await peer.call({ action: "contract", card: "1", path: "p.md", goal: "g", acceptance: "a", scopeOut: "s" });
		await lead.call({ action: "approve", card: "1" });
		await peer.call({ action: "move", card: "1", lane: "execute" });
		expect(text(await peer.call({ action: "review", card: "1" }))).toContain(
			"A card is spot-checked by a session that does not hold it.",
		);
		expect(text(await peer.call({ action: "move", card: "1", lane: "done" }))).toContain("has no spot-check recorded");
		await lead.call({ action: "review", card: "1" });
		expect((await peer.call({ action: "move", card: "1", lane: "done" })).details.card?.lane).toBe("done");
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
		const lead = harness({ cwd, agentDir, sessionId: "s-lead" });
		const peer = harness({ cwd, agentDir, sessionId: "s-peer" });
		await lead.call({ action: "add", title: "One" });
		await peer.call({ action: "claim", card: "1" });
		const result = await lead.call({ action: "drop", card: "1" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("cannot be dropped while someone holds it");
		expect(result.details.card?.id).toBe("1");
	});
});

describe("archive", () => {
	test("sets a finished card aside and names the way to read it again", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "Finished one", note: "kept" });
		await call({ action: "add", title: "Open one" });
		await seed(board, "1", "done");
		const result = await call({ action: "archive", card: "1" });
		expect(result.details.archived).toEqual(["1"]);
		expect(text(result)).toBe(
			"1 card archived: #1 — out of the board, its notes and plan still readable with archived: true.",
		);
		// The board no longer pays for it, and a listing that left it out says so rather
		// than reading as history somebody deleted.
		const listed = await call({ action: "list" });
		expect(listed.details.cards?.map((card) => card.id)).toEqual(["2"]);
		expect(text(listed)).toContain("1 card is set aside in the archive; pass archived: true to read it.");
		// Gone and set aside are different answers.
		const miss = await call({ action: "list", card: "1" });
		expect(miss.isError).toBe(true);
		expect(miss.details.error).toBe("#1 is archived; pass archived: true to read it.");
		const pile = await call({ action: "list", archived: true });
		expect(pile.details.cards?.map((card) => card.id)).toEqual(["1"]);
		expect(text(pile)).toContain(`#1 done · Finished one · ${LEAD}`);
	});

	test("names a card the sweep could not set aside, instead of dropping it from the report", async () => {
		const board = boardHarness({ now: NOW, track: temps.track });
		// A store where one card changes underneath the sweep: the refusal is the case the
		// report must not swallow, because "every finished card" would read as fewer.
		const inner = board.runtime;
		const refuseOnce = { refused: false };
		const racing = {
			...inner,
			store: async (cwd: string) => {
				const store = await inner.store(cwd);
				return {
					...store,
					mutate: async (...args: Parameters<typeof store.mutate>) => {
						const [id, op] = args;
						if (id === "2" && op.kind === "archive" && !refuseOnce.refused) {
							refuseOnce.refused = true;
							return { ok: false as const, error: "#2 kept changing while it was written; read it again." };
						}
						return store.mutate(...args);
					},
				};
			},
		};
		registerTools(board.fake.pi, racing as typeof inner);
		const tool = board.fake.pi.tools.get("board");
		if (!tool) throw new Error("the board tool was not registered");
		const call = async (args: Record<string, unknown>) =>
			(await tool.execute("call-1", args, undefined, undefined, board.ctx)) as {
				content: Array<{ text: string }>;
				details: BoardDetails;
			};

		for (const title of ["One", "Two", "Three"]) await call({ action: "add", title });
		await seed({ runtime: board.runtime, ctx: board.ctx }, "1", "done");
		await seed({ runtime: board.runtime, ctx: board.ctx }, "2", "done");
		await call({ action: "claim", card: "3" });

		const result = await call({ action: "archive" });
		expect(result.details.archived).toEqual(["1"]);
		expect(result.details.failed).toEqual([
			{ card: "2", error: "#2 kept changing while it was written; read it again." },
		]);
		expect(text(result)).toContain("1 card archived: #1");
		expect(text(result)).toContain("#2 was not archived (#2 kept changing while it was written; read it again.)");
		// And the card is still on the board, in its lane: a refusal never half-applies.
		expect((await call({ action: "list", lane: "done" })).details.cards?.map((card) => card.id)).toEqual(["2"]);
	});

	test("sets every finished card aside when no card is named", async () => {
		const board = harness();
		const { call } = board;
		for (const title of ["One", "Two", "Three"]) await call({ action: "add", title });
		await seed(board, "1", "done");
		await seed(board, "2", "done");
		await call({ action: "claim", card: "3" });
		const result = await call({ action: "archive" });
		expect(result.details.archived).toEqual(["1", "2"]);
		expect(text(result)).toContain("2 cards archived: #1, #2");
		expect((await call({ action: "list" })).details.cards?.map((card) => card.id)).toEqual(["3"]);
		expect((await call({ action: "list", archived: true })).details.cards?.map((card) => card.id)).toEqual(["1", "2"]);
		// Nothing finished left to move is an answer, not a failure.
		expect(text(await call({ action: "archive" }))).toBe("No finished cards to archive.");
	});

	test("refuses a card that has not finished, and one that is already aside", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "One" });
		const refused = await call({ action: "archive", card: "1" });
		expect(refused.isError).toBe(true);
		expect(refused.details.error).toBe("#1 is in backlog; only a finished card can be archived.");
		await seed(board, "1", "done");
		await call({ action: "archive", card: "1" });
		expect(text(await call({ action: "archive", card: "1" }))).toBe("#1 is already archived.");
	});

	test("keeps the id spent, so the next card takes a new one", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "One" });
		await seed(board, "1", "done");
		await call({ action: "archive", card: "1" });
		const added = await call({ action: "add", title: "Two" });
		expect(added.details.card?.id).toBe("2");
	});

	test("refuses a lane and a rollup, which an out-of-board pile has no answer for", async () => {
		const { call } = harness();
		const lane = await call({ action: "list", archived: true, lane: "done" });
		expect(lane.isError).toBe(true);
		expect(lane.details.error).toBe(
			"archived does not read lane: the archive is one pile of finished cards, out of the board.",
		);
		expect((await call({ action: "list", archived: true, round: true })).details.error).toContain("round");
	});

	test("counts what it left aside under the rollup too, and reads one archived card by id", async () => {
		const board = harness();
		const { call } = board;
		await call({ action: "add", title: "One" });
		await seed(board, "1", "done");
		await call({ action: "archive", card: "1" });
		const round = await call({ action: "list", round: true });
		expect(text(round)).toContain("0 features");
		expect(text(round)).toContain("1 card is set aside in the archive");
		const one = await call({ action: "list", archived: true, card: "1" });
		expect(one.details.card?.id).toBe("1");
		expect(text(one)).toContain("#1 done · One");
		// The other direction: an id the archive does not hold is named as such.
		expect((await call({ action: "list", archived: true, card: "9" })).details.error).toBe("#9 is not in the archive.");
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
	test("a claim joins once, under this session's own name", async () => {
		const { team, calls, labels } = recordingTeam();
		const { call } = harness({ team });
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		await call({ action: "claim", card: "1" });
		await call({ action: "claim", card: "2" });
		expect(calls).toHaveLength(1);
		// The label is the card's owner label, so the bus, the roster and the card agree.
		expect(labels).toEqual([LEAD]);
	});

	test("no other action joins: a read, a new card, a note or an edit enlists nobody", async () => {
		const { team, calls } = recordingTeam();
		const { call } = harness({ team });
		await call({ action: "list" });
		await call({ action: "list", round: true });
		await call({ action: "add", title: "One" });
		await call({ action: "note", card: "1", text: "looked at it" });
		await call({ action: "edit", card: "1", title: "One, renamed" });
		expect(calls).toEqual([]);
	});

	test("a refused claim wrote nothing, so it enlists nobody", async () => {
		const { team, calls } = recordingTeam();
		const board = harness({ team });
		const { call } = board;
		await call({ action: "add", title: "One" });
		await call({ action: "claim", card: "1" });
		await seed(board, "1", "done");
		// A done card cannot be claimed, so the refusal is not a second join.
		const refused = await call({ action: "claim", card: "1" });
		expect(refused.isError).toBe(true);
		expect(calls).toHaveLength(1);
	});

	test("a refused join leaves the board working, and the next claim asks again", async () => {
		const { team, calls } = recordingTeam(() => ({ ok: false, error: "the session bus is not loaded" }));
		const { call, runtime } = harness({ team });
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		const first = await call({ action: "claim", card: "1" });
		expect(first.isError).toBeFalsy();
		// The failure is kept, because `/board status` says why there is no team.
		expect(runtime.team.last()).toEqual({ ok: false, error: "the session bus is not loaded" });
		await call({ action: "claim", card: "2" });
		expect(calls).toHaveLength(2);
	});
});
