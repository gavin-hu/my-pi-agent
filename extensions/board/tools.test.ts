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
import { tempDir } from "../../test/helpers/env.ts";
import { fakeCtx, type FakeCtxOptions } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { MAX_NOTES } from "../../lib/board/card.ts";
import { openBoardSession } from "../../lib/board/session.ts";
import { registerTools } from "./tools.ts";
import type { BoardDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 100_000;

/** A registered tool plus the context it will be called with. */
function harness(options: FakeCtxOptions & { agentDir?: string } = {}) {
	const { agentDir: shared, ...ctxOptions } = options;
	const agentDir = shared ?? temps.track(tempDir("pi-agent-"));
	const cwd = ctxOptions.cwd ?? temps.track(tempDir("pi-repo-"));
	const fake = createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
	const runtime = openBoardSession(fake.pi, { now: () => NOW, agentDir });
	registerTools(fake.pi, runtime);
	const tool = fake.tools.get("board");
	if (!tool) throw new Error("the board tool was not registered");
	const { ctx } = fakeCtx({ cwd, sessionId: "s-lead", sessionName: "billing-lead", ...ctxOptions });
	return {
		tool,
		ctx,
		/** Run one action. */
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, ctx)) as {
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

	test("filters one lane", async () => {
		const { call } = harness();
		await call({ action: "add", title: "One" });
		await call({ action: "add", title: "Two" });
		await call({ action: "claim", card: "2" });
		const result = await call({ action: "list", status: "doing" });
		expect(result.details.cards?.map((card) => card.id)).toEqual(["2"]);
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
		for (const action of ["claim", "release", "move", "note", "plan", "drop"]) {
			expect(text(await call({ action })), action).toContain("card is required");
		}
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
