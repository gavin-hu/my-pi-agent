/**
 * The handoff: its text, its length cap, and how a nested `session send` becomes a
 * result or a throw.
 *
 * The transport is where "send first, assign second" gets its meaning, so the cases
 * pin both directions — a clean outcome with the labels it wrote for, and a failed
 * one whose message is what the lead reads.
 */

import { describe, expect, test } from "bun:test";
import type { Card } from "../../lib/workflow/card.ts";
import { askLead } from "../../lib/workflow/contract.ts";
import { boardCard as cardFixture } from "../../test/helpers/fixtures/board.ts";
import { MAX_MESSAGE_TEXT } from "../../lib/session-tool.ts";
import { askText } from "./dispatch.ts";
import { actorFor, handoffText, noticeText, offerText, ownerFor } from "../../lib/workflow/notice.ts";

/** The lead a case hands the builder: the name a sign has to carry. */
const LEAD = "billing-lead";

/** A claimed card, which is what a handoff describes. */
function card(overrides: Partial<Card> = {}): Card {
	return cardFixture("4", {
		lane: "execute",
		title: "Billing webhook accepts orders",
		owner: { id: "s-lead", label: "billing-lead" },
		paths: ["src/billing"],
		rev: 2,
		createdAt: 1_000,
		updatedAt: 1_000,
		...overrides,
	});
}

describe("handoffText", () => {
	test("names the card, its outcome, and says the card is already the peer's", () => {
		const text = handoffText(card(), "billing-core", LEAD);
		expect(text).toContain('Handoff: #4 "Billing webhook accepts orders" is yours, billing-core.');
		expect(text).toContain("Paths: src/billing");
		// The card is written before the message exists, so the first step is the contract — a claim
		// would be the no-op the order no longer needs.
		expect(text).toContain('Write its contract with board action "contract"');
		expect(text).not.toContain('action "claim"');
	});

	test("names the two moves the lead has to sign, and who to tell", () => {
		const text = handoffText(card(), "billing-core", LEAD);
		// The next move after "write the contract" is `execute`, which the store refuses
		// without the lead's `approve`; `done` is refused without its `review`. A message
		// that named those moves and not their signer was an instruction to be refused.
		// The verb, not just the name: #151 gives the refusal the same channel, so the two say
		// one thing about how a peer reaches the lead.
		expect(text).toContain("`blocked` is yours to set");
		expect(text).toContain(`needs the lead (${LEAD}) to \`approve\` the contract`);
		expect(text).toContain("`done` needs the lead's `review`");
		expect(text).toContain(`ask ${LEAD} with \`session send\` when each is ready`);
	});

	test("carries the plan when one is recorded, and the lead's note when there is one", () => {
		const text = handoffText(
			card({ planPath: "~/.pi/agent/plans/k/one.md" }),
			"billing-core",
			LEAD,
			"start with the webhook",
		);
		expect(text).toContain("Plan: ~/.pi/agent/plans/k/one.md");
		expect(text).toContain("Note: start with the webhook");
	});

	test("says what to do if the card was taken back after the message", () => {
		// The write lands first, so the only way the peer reads another owner is a reclaim in
		// between — one condition, not the two the old send-first order had.
		const text = handoffText(card(), "billing-core", LEAD);
		expect(text).toContain("If the board shows another owner");
		expect(text).toContain(`leave it alone and ${askLead(LEAD)}`);
		expect(text).not.toContain("claim it with");
		expect(text.indexOf("taken back")).toBeLessThan(text.indexOf("Paths:"));
	});

	test("stays inside the send limit, however many paths a card carries", () => {
		const long = card({ paths: Array.from({ length: 60 }, (_, index) => `${"x".repeat(190)}${index}`) });
		// The clip is composition's (`noticeText`), so the text a door sends is the one asserted here.
		const text = noticeText("assign", long, { lead: LEAD, to: "billing-core" });
		expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT);
		// A clipped message must keep the step it was sent to give: the paths are the only
		// line long enough to push the gates past the limit, so both sentences come before them.
		expect(text).toContain(`ask ${LEAD} with \`session send\` when each is ready`);
		expect(text).toContain("was taken back after this message");
		expect(text).toContain(`leave it alone and ${askLead(LEAD)}`);
	});
});

describe("offerText", () => {
	test("says the card is unclaimed, and that claiming it is the next step", () => {
		const text = offerText(card(), LEAD);
		expect(text).toContain('Offer: #4 "Billing webhook accepts orders" is unclaimed.');
		expect(text).toContain("Paths: src/billing");
		expect(text).toContain('action "claim"');
		// An offer names no owner: a peer that read "yours" would not claim at all.
		expect(text).not.toContain("is yours,");
	});

	test("names the same two gates, so a claimer is not walked into a refusal", () => {
		const text = offerText(card(), LEAD);
		expect(text).toContain(`needs the lead (${LEAD}) to \`approve\` the contract`);
		expect(text).toContain("`done` needs the lead's `review`");
		expect(text).toContain(`ask ${LEAD} with \`session send\` when each is ready`);
	});

	test("carries the plan and the lead's note, and stays inside the send limit", () => {
		const text = offerText(card({ planPath: "~/.pi/agent/plans/k/one.md" }), LEAD, "whoever is free");
		expect(text).toContain("Plan: ~/.pi/agent/plans/k/one.md");
		expect(text).toContain("Note: whoever is free");
		const long = card({ paths: Array.from({ length: 60 }, (_, index) => `${"x".repeat(190)}${index}`) });
		expect(offerText(long, LEAD).length).toBeLessThanOrEqual(MAX_MESSAGE_TEXT);
	});
});

describe("actorFor", () => {
	const peers = [
		{ id: "s-core", label: "billing-core", listening: true },
		{ id: "s-web", label: "billing-web" },
	];

	test("makes an id the peer that answers to it, which is what a holder's record is compared with", () => {
		expect(actorFor(peers, "s-core")).toEqual({ id: "s-core", label: "billing-core" });
		expect(actorFor(peers, "BILLING-WEB")).toEqual({ id: "s-web", label: "billing-web" });
	});

	test("keeps the label when the bus could not say, which is not a peer with no id", () => {
		expect(actorFor(undefined, " billing-core ")).toEqual({ label: "billing-core" });
		expect(actorFor(peers, "nobody")).toEqual({ label: "nobody" });
	});

	test("keeps a named id's meaning, so a stopped session is reported rather than replaced", () => {
		// The caller asked for that session; the send is what refuses it. Resolving to nothing here would
		// record a label the session had already stopped answering to.
		const stopped = [
			{ id: "s-dead", label: "billing-core", state: "gone" as const },
			{ id: "s-live", label: "billing-core", listening: true, state: "live" as const },
		];
		expect(actorFor(stopped, "s-dead")).toEqual({ id: "s-dead", label: "billing-core" });
		// The same pair by label names the live session: a label is a role, and one live session holds it.
		expect(actorFor(stopped, "billing-core")).toEqual({ id: "s-live", label: "billing-core" });
	});

	test("records the label alone when two live sessions share it", () => {
		// The send refuses an ambiguous label in its own sentence, so nothing is delivered under it — and
		// the card must not credit the message to whichever record the bus listed first.
		const shared = [
			{ id: "s-1", label: "billing-core", state: "live" as const },
			{ id: "s-2", label: "Billing-Core", state: "live" as const },
		];
		expect(actorFor(shared, "billing-core")).toEqual({ label: "billing-core" });
	});
});

describe("ownerFor", () => {
	const handoff = { at: 7, told: { at: 7 } };

	test("records the label the bus wrote for, and the requested one when there is none", () => {
		expect(ownerFor("billing-core", ["billing-core"], handoff)).toEqual({
			label: "billing-core",
			handoff: { at: 7, told: { at: 7 }, unresolved: true },
		});
		expect(ownerFor("billing-core", [], handoff).label).toBe("billing-core");
		expect(ownerFor("s-core", ["billing-core"], handoff).label).toBe("billing-core");
	});

	test("marks the handoff unresolved, because the label is all it could learn", () => {
		// The marker is what stops `holds` falling back to the label: without it the next session to
		// draw that label would inherit every write on the card.
		expect(ownerFor("billing-core", [], { at: 9 }).handoff).toEqual({ at: 9, unresolved: true });
		expect(ownerFor("billing-core", [], { at: 9 }).id).toBeUndefined();
	});
});

describe("askText", () => {
	const byId = { to: "7f3a91c2", byId: true };

	test("puts the question first and names the ask and the one way back", () => {
		const text = askText("is #162 ready for review?", "a1b2c3d4", byId);
		expect(text.startsWith("Ask a1b2c3d4: is #162 ready for review?")).toBe(true);
		expect(text).toContain('session send to "7f3a91c2" (a session id, not a label)');
		// The reply sets the envelope field rather than only a prose prefix: the bus prints it as
		// `re: <id>` on the row, and the ask says so.
		expect(text).toContain('replyTo "a1b2c3d4"');
		expect(text).toContain("re: a1b2c3d4");
		expect(text).toContain("nothing is waiting on it");
	});

	test("says when the way back is a label, because the bus held no id", () => {
		// The fallback has to read as one: a peer that took a label for an id would send the answer to
		// whatever holds that label next, which is what the id exists to avoid.
		const text = askText("any blockers?", "a1b2c3d4", { to: "billing-lead", byId: false });
		expect(text).toContain('session send to "billing-lead" (the label');
		expect(text).toContain("the bus holds no id for this session");
	});

	test("clips at the bus's limit, like every other body here", () => {
		const text = askText("x".repeat(MAX_MESSAGE_TEXT * 2), "a1b2c3d4", byId);
		expect(text.length).toBe(MAX_MESSAGE_TEXT);
		expect(text.endsWith("…")).toBe(true);
	});
});
