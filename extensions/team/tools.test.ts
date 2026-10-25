/**
 * The `team` tool: the order of a handoff, and what each failure leaves behind.
 *
 * The ordering is the whole point — a message before an assignment, and a card
 * untouched when the message fails — so the cases drive a recording dispatch and
 * assert both the calls made and the card the store ends up with.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "../../test/helpers/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { openBoardSession } from "../../lib/board/session.ts";
import type { Peer } from "../../lib/session-tool.ts";
import type { Dispatch } from "./dispatch.ts";
import { registerTools } from "./tools.ts";
import type { TeamDetails } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 90_000;

/** A tool, its context, and the dispatch it records into. */
function harness(options: { fail?: string; peers?: Peer[] } = {}) {
	const agentDir = temps.track(tempDir("pi-agent-"));
	const cwd = temps.track(tempDir("pi-repo-"));
	const fake = createFakePi({ exec: async () => ({ stdout: "", stderr: "", code: 1 }) });
	const session = openBoardSession(fake.pi, { now: () => NOW, agentDir });
	const sent: Array<{ kind: "handoff" | "event"; to: string; text: string }> = [];
	const dispatch: Dispatch = {
		async send(input) {
			if (options.fail !== undefined) throw new Error(options.fail);
			sent.push(input);
			return { delivered: input.to === "*" ? ["billing-core", "billing-web"] : [input.to] };
		},
		// A stub that lists the peers the sends reached, so the assign path records the id
		// a rename would keep; a case that needs a state passes its own list.
		async peers() {
			return options.peers ?? sent.map((input) => ({ id: `s-${input.to}`, label: input.to, listening: true }));
		},
	};
	registerTools(fake.pi, session, { dispatch: () => dispatch });
	const tool = fake.tools.get("team");
	if (!tool) throw new Error("the team tool was not registered");
	const { ctx } = fakeCtx({ cwd, sessionId: "s-lead", sessionName: "billing-lead" });
	return {
		tool,
		ctx,
		sent,
		cwd,
		/** The store this session works on, so a case seeds the same board it reads. */
		store: () => session.store(cwd),
		/** Publish one card on that board and return its id. */
		async seed(title = "Billing webhook accepts orders"): Promise<string> {
			const store = await session.store(cwd);
			await store.ensure();
			const card = await store.create({ title, paths: ["src/billing"] }, { label: "billing-lead" }, NOW);
			return card.id;
		},
		async call(args: Record<string, unknown>) {
			return (await tool.execute("call-1", args, undefined, undefined, ctx)) as {
				content: Array<{ text: string }>;
				details: TeamDetails;
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
		expect(tool.name).toBe("team");
		expect(tool.promptSnippet.length).toBeGreaterThan(0);
		expect(tool.promptGuidelines.length).toBeGreaterThan(0);
		expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
		expect(tool.executionMode).toBe("sequential");
	});

	test("says which action needs no team", () => {
		const { tool } = harness();
		// Read every session, so the claim has to be the true one: `reclaim` writes the card
		// alone, and a model told otherwise goes looking for a bus it does not need.
		expect(tool.description).toContain("needs no team");
		expect(tool.description).not.toContain("All three need the team");
	});

	test("refuses an action it does not have, without throwing", async () => {
		const { call } = harness();
		const result = await call({ action: "spawn", card: "1" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain("unknown action");
	});

	test("refuses a card id that is not one", async () => {
		const { call } = harness();
		expect(text(await call({ action: "reclaim", card: "four" }))).toContain('"four" is not a card id.');
	});
});

describe("assign", () => {
	test("sends the handoff first, then records the owner", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core", note: "start with the webhook" });
		expect(result.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("billing-core");
		expect(sent[0]?.text).toContain("Note: start with the webhook");
		// The id comes from the bus, so a peer that renames itself still holds its card.
		expect(result.details.card).toMatchObject({
			status: "doing",
			owner: { id: "s-billing-core", label: "billing-core" },
		});
		expect(result.details.delivered).toEqual(["billing-core"]);
		expect(text(result)).toContain("#1 handed off to billing-core.");
		// Listening is the default the stub reports, so no warning line is added.
		expect(text(result)).not.toContain("Not listening");
	});

	test("names the peer when its record says it is not listening", async () => {
		const { call, seed } = harness({ peers: [{ id: "s-billing-core", label: "billing-core", listening: false }] });
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(text(result)).toContain("Not listening: billing-core — it reads this at its next turn.");
		expect(result.details.notListening).toEqual(["billing-core"]);
	});

	test("names the peer it must be told about, and sends nothing without one", async () => {
		const { call, seed, sent } = harness();
		const id = await seed();
		const result = await call({ action: "assign", card: id });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("assign needs a peer");
		expect(sent).toEqual([]);
	});

	test("refuses a card that does not exist, before sending anything", async () => {
		const { call, sent } = harness();
		const result = await call({ action: "assign", card: "9", to: "billing-core" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("#9 does not exist.");
		expect(sent).toEqual([]);
	});

	test("refuses a finished card, before sending anything", async () => {
		const { call, seed, store, sent } = harness();
		const id = await seed();
		// Finish it as its owner would.
		const board = await store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await board.mutate(id, { kind: "move", status: "done" }, { label: "billing-core" }, NOW);
		const result = await call({ action: "assign", card: id, to: "billing-other" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("is done");
		expect(sent).toEqual([]);
	});

	test("a send that fails leaves the card exactly as it was", async () => {
		const { call, seed, sent } = harness({ fail: "the bus is not loaded." });
		const id = await seed();
		const result = await call({ action: "assign", card: id, to: "billing-core" });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("was not handed off to billing-core: the bus is not loaded.");
		expect(text(result)).toContain("The card is unchanged.");
		expect(sent).toEqual([]);
		expect(result.details.card).toMatchObject({ status: "todo" });
		expect(result.details.card?.owner).toBeUndefined();
	});
});

describe("offer", () => {
	test("broadcasts the card as an event and writes nothing", async () => {
		const { call, seed, sent, store } = harness();
		const id = await seed();
		const before = await (await store()).read(id);
		const result = await call({ action: "offer", card: id, note: "whoever is free" });
		expect(result.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ kind: "event", to: "*" });
		expect(sent[0]?.text).toContain("is unclaimed");
		expect(sent[0]?.text).toContain("Note: whoever is free");
		// Nothing half-applied is possible: the card is exactly as the rules read it.
		expect(result.details.card?.rev).toBe(before?.rev);
		expect(result.details.card?.owner).toBeUndefined();
		expect((await (await store()).read(id))?.rev).toBe(before?.rev);
		expect(text(result)).toContain("#1 offered to billing-core, billing-web.");
		expect(text(result)).toContain("unowned until one of them claims it");
	});

	test("refuses a card somebody holds, and one that waits, without broadcasting", async () => {
		const { call, seed, sent, store } = harness();
		const first = await seed("First");
		const board = await store();
		await board.mutate(first, { kind: "claim" }, { label: "billing-core" }, NOW);
		const held = await call({ action: "offer", card: first });
		expect(held.isError).toBe(true);
		expect(text(held)).toContain("is held by billing-core");

		const second = await seed("Second");
		await board.mutate(
			second,
			{ kind: "edit", title: undefined, paths: undefined, priority: undefined, dependsOn: [first] },
			{ label: "billing-core" },
			NOW,
		);
		const waiting = await call({ action: "offer", card: second });
		expect(waiting.isError).toBe(true);
		expect(text(waiting)).toContain("waits on");
		expect(sent).toEqual([]);
	});

	test("reports a broadcast that reached nobody, and leaves the card alone", async () => {
		const { call, seed, store } = harness({ fail: "no other active sessions." });
		const id = await seed();
		const before = await (await store()).read(id);
		const result = await call({ action: "offer", card: id });
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("#1 was not offered: no other active sessions.");
		expect(text(result)).toContain("The card is unchanged.");
		expect((await (await store()).read(id))?.rev).toBe(before?.rev);
	});

	test("names the peers it reached that are not listening", async () => {
		const peers = [
			{ id: "s-billing-core", label: "billing-core", listening: true },
			{ id: "s-billing-web", label: "billing-web", listening: false },
		];
		const { call, seed } = harness({ peers });
		const id = await seed();
		const result = await call({ action: "offer", card: id });
		expect(text(result)).toContain("Not listening: billing-web");
		expect(result.details.notListening).toEqual(["billing-web"]);
	});
});

describe("reclaim", () => {
	test("clears the owner and keeps the notes", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		const board = await store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await board.mutate(id, { kind: "note", text: "half done" }, { label: "billing-core" }, NOW);

		const result = await call({ action: "reclaim", card: id });
		expect(result.isError).toBeFalsy();
		expect(result.details.card).toMatchObject({ status: "todo" });
		expect(result.details.card?.owner).toBeUndefined();
		expect(result.details.card?.notes.map((note) => note.text)).toEqual(["half done"]);
		expect(text(result)).toContain("#1 reclaimed from billing-core");
	});

	test("refuses a card nobody holds, and one that is finished", async () => {
		const { call, seed, store } = harness();
		const id = await seed();
		expect(text(await call({ action: "reclaim", card: id }))).toContain("has no owner to reclaim.");

		const board = await store();
		const other = await board.create({ title: "Second", paths: [] }, { label: "billing-lead" }, NOW);
		await board.mutate(other.id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await board.mutate(other.id, { kind: "move", status: "done" }, { label: "billing-core" }, NOW);
		expect(text(await call({ action: "reclaim", card: other.id }))).toContain("is done");
	});

	test("sends nothing", async () => {
		const { call, seed, store, sent } = harness();
		const id = await seed();
		const board = await store();
		await board.mutate(id, { kind: "claim" }, { label: "billing-core" }, NOW);
		await call({ action: "reclaim", card: id });
		expect(sent).toEqual([]);
	});
});
