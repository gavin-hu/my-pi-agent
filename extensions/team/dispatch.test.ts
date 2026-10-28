/**
 * The handoff: its text, its length cap, and how a nested `session send` becomes a
 * result or a throw.
 *
 * The transport is where "send first, assign second" gets its meaning, so the cases
 * pin both directions — a clean outcome with the labels it wrote for, and a failed
 * one whose message is what the lead reads.
 */

import { describe, expect, test } from "bun:test";
import type { Card } from "../../lib/board/card.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { MAX_MESSAGE_TEXT } from "../../lib/session-tool.ts";
import { handoffText, notListening, offerText, ownerFor, peerFor, sessionDispatch } from "./dispatch.ts";

/** A claimed card, which is what a handoff describes. */
function card(overrides: Partial<Card> = {}): Card {
	return {
		v: 1,
		id: "4",
		title: "Billing webhook accepts orders",
		lane: "execute",
		owner: { id: "s-lead", label: "billing-lead" },
		paths: ["src/billing"],
		notes: [],
		notesDropped: 0,
		rev: 2,
		createdAt: 1_000,
		updatedAt: 1_000,
		by: "billing-lead",
		...overrides,
	};
}

describe("handoffText", () => {
	test("names the card, its outcome, and says the card is already the peer's", () => {
		const text = handoffText(card(), "billing-core");
		expect(text).toContain('Handoff: #4 "Billing webhook accepts orders" is yours, billing-core.');
		expect(text).toContain("Paths: src/billing");
		expect(text).toContain("already assigned to you");
		// `assign` records the owner, so asking the peer to claim would send it into a
		// no-op at best and a refusal at worst; the claim belongs to the failure path.
		expect(text).not.toContain('action "claim"');
	});

	test("carries the plan when one is recorded, and the lead's note when there is one", () => {
		const text = handoffText(
			card({ planPath: "~/.pi/agent/plans/k/one.md" }),
			"billing-core",
			"start with the webhook",
		);
		expect(text).toContain("Plan: ~/.pi/agent/plans/k/one.md");
		expect(text).toContain("Note: start with the webhook");
	});

	test("stays inside the send limit, however many paths a card carries", () => {
		const long = card({ paths: Array.from({ length: 12 }, (_, index) => `${"x".repeat(190)}${index}`) });
		expect(handoffText(long, "billing-core").length).toBeLessThanOrEqual(4_000);
	});
});

describe("offerText", () => {
	test("says the card is unclaimed, and that claiming it is the next step", () => {
		const text = offerText(card());
		expect(text).toContain('Offer: #4 "Billing webhook accepts orders" is unclaimed.');
		expect(text).toContain("Paths: src/billing");
		expect(text).toContain('action "claim"');
		// An offer names no owner: a peer that read "yours" would not claim at all.
		expect(text).not.toContain("is yours");
	});

	test("carries the plan and the lead's note, and stays inside the send limit", () => {
		const text = offerText(card({ planPath: "~/.pi/agent/plans/k/one.md" }), "whoever is free");
		expect(text).toContain("Plan: ~/.pi/agent/plans/k/one.md");
		expect(text).toContain("Note: whoever is free");
		const long = card({ paths: Array.from({ length: 12 }, (_, index) => `${"x".repeat(190)}${index}`) });
		expect(offerText(long).length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT);
	});
});

describe("sessionDispatch", () => {
	test("sends a handoff through the session tool and reports the labels it wrote for", async () => {
		const { ctx, toolCalls } = fakeCtx({ extra: {} });
		ctx.executeTool = async (name: string, args: unknown) => {
			toolCalls.push({ name, args });
			return {
				isError: false,
				result: { content: [], details: { action: "send", delivered: ["billing-core"], messageId: "m1" } },
			};
		};
		const result = await sessionDispatch(ctx).send({ kind: "handoff", to: "billing-core", text: "Handoff: take #4" });
		expect(result.delivered).toEqual(["billing-core"]);
		expect(toolCalls[0]).toEqual({
			name: "session",
			args: { action: "send", kind: "handoff", to: "billing-core", text: "Handoff: take #4" },
		});
	});

	test("turns a failed outcome into a throw with the message the model would have read", async () => {
		const { ctx } = fakeCtx({ executeError: 'no active session "billing-core".' });
		await expect(sessionDispatch(ctx).send({ kind: "handoff", to: "billing-core", text: "text" })).rejects.toThrow(
			'no active session "billing-core".',
		);
	});

	test("a failure with no text still says the send did not land", async () => {
		const { ctx } = fakeCtx();
		ctx.executeTool = async () => ({ isError: true, result: { content: [], details: undefined } });
		await expect(sessionDispatch(ctx).send({ kind: "event", to: "*", text: "text" })).rejects.toThrow(
			"the session bus did not answer.",
		);
	});

	test("lists the peers the bus knows, with the state their record carries", async () => {
		const { ctx } = fakeCtx();
		ctx.executeTool = async (_name: string, args: unknown) => {
			if ((args as { action?: string }).action === "status") {
				return {
					isError: false,
					result: {
						content: [],
						details: {
							action: "status",
							status: {
								me: { id: "s-lead", label: "billing-lead" },
								onBus: true,
								sessions: [
									{ id: "s-core", label: "billing-core", watching: { armed: true, wake: false } },
									{ id: "s-web", label: "billing-web" },
								],
								claims: [],
							},
						},
					},
				};
			}
			throw new Error("unexpected call");
		};
		expect(await sessionDispatch(ctx).peers()).toEqual([
			{ id: "s-core", label: "billing-core", listening: true },
			{ id: "s-web", label: "billing-web" },
		]);
	});

	test("a read that fails answers nothing rather than undoing a handoff", async () => {
		const { ctx } = fakeCtx({ executeError: true });
		expect(await sessionDispatch(ctx).peers()).toBeUndefined();
	});

	test("an outcome without labels reports none, rather than inventing a recipient", async () => {
		const { ctx } = fakeCtx();
		ctx.executeTool = async () => ({ isError: false, result: { content: [], details: {} } });
		expect((await sessionDispatch(ctx).send({ kind: "handoff", to: "peer", text: "text" })).delivered).toEqual([]);
	});
});

describe("peerFor", () => {
	const peers = [
		{ id: "s-core", label: "billing-core", listening: true },
		{ id: "s-web", label: "billing-web" },
	];

	test("finds a peer by id exactly, then by label ignoring case", () => {
		expect(peerFor(peers, "s-core")?.label).toBe("billing-core");
		expect(peerFor(peers, "BILLING-WEB")?.id).toBe("s-web");
		expect(peerFor(peers, " nobody ")).toBeUndefined();
	});

	test("answers nothing when the bus could not say, which is not an empty team", () => {
		expect(peerFor(undefined, "billing-core")).toBeUndefined();
	});
});

describe("notListening", () => {
	test("names the peers whose record says they are not listening", () => {
		const peers = [
			{ id: "s-core", label: "billing-core", listening: true },
			{ id: "s-web", label: "billing-web", listening: false },
			{ id: "s-old", label: "ops-helper" },
		];
		// A record that does not say is not a claim that nobody will read it.
		expect(notListening(peers, ["billing-core", "billing-web", "ops-helper", "ghost"])).toEqual(["billing-web"]);
		expect(notListening(undefined, ["billing-web"])).toEqual([]);
	});
});

describe("ownerFor", () => {
	test("records the label the bus wrote for, and the requested one when there is none", () => {
		expect(ownerFor("billing-core", ["billing-core"])).toEqual({ label: "billing-core" });
		expect(ownerFor("billing-core", [])).toEqual({ label: "billing-core" });
		expect(ownerFor("s-core", ["billing-core"])).toEqual({ label: "billing-core" });
	});
});
