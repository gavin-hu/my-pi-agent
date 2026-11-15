/**
 * The contract's own message: the one a peer sends the lead when its wording becomes approvable.
 *
 * The first gate is the lead's, so this is the only message in the round that travels towards a
 * signature. What these cases pin is the moment it is owed — a write that changed something and
 * left a whole, unsigned contract — and the three states it must stay quiet in: a repeated call,
 * a contract already signed, and a board that names no lead. A failed send is a line on the
 * result and never the write, which is the same rule a sign's message keeps.
 *
 * It is its own suite because `tools.test.ts` is named at its height in
 * `test/suite-sizes.test.ts`, and a named suite may not gain a line.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import {
	bench,
	flushFixture,
	LEAD,
	onBus,
	type Sent,
	signBus,
	signPlan,
	type Session,
} from "../../test/helpers/board-signs.ts";

afterAll(flushFixture);

/** The three lines a half-written contract holds, so one call can complete it. */
const HALF = { goal: "g", acceptance: "a", scopeOut: "s" };

/** The fourth line, which is the one that makes a contract whole. */
const VERIFY = "bun run check";

/**
 * A claimed card whose contract states three lines, and the plan it names.
 *
 * Nothing is approvable yet, which is the state each case starts from: the write that adds
 * `verify` is the transition under test, and starting from `claimedWithContract` would spend it
 * inside the fixture.
 */
async function halfContract(who: { peer: Session }): Promise<string> {
	const plan = await signPlan(who.peer);
	await who.peer.call({ action: "add", title: "One" });
	await who.peer.call({ action: "claim", card: "1" });
	const written = await who.peer.call({ action: "contract", card: "1", path: plan, ...HALF });
	expect(written.isError).toBeFalsy();
	return plan;
}

describe("a contract that became approvable", () => {
	test("tells the lead, naming the card and both doors a sign has", async () => {
		const sent: Sent[] = [];
		const who = bench({ notify: signBus({ sent, delivered: LEAD }) });
		const plan = await halfContract(who);
		// Three lines are not a contract the lead can sign, so nothing has been said yet.
		expect(sent).toHaveLength(0);

		const done = await who.peer.call({ action: "contract", card: "1", path: plan, verify: VERIFY });
		expect(done.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.kind).toBe("event");
		// No record answers to the lead's label here, so the label is what the bus is addressed with.
		expect(sent[0]?.to).toBe(LEAD);
		expect(sent[0]?.text).toContain('Contract ready: #1 "One"');
		expect(sent[0]?.text).toContain(`the lead (${LEAD}) approves`);
		expect(sent[0]?.text).toContain("`/board approve 1`");
		expect(resultText(done)).toContain(`told ${LEAD}`);
		// The transcript block reads the same clause without the body's continuation indent.
		expect(done.details.told).toBe(`told ${LEAD}`);
	});

	test("says nothing for a write that changed nothing", async () => {
		const sent: Sent[] = [];
		const who = bench({ notify: signBus({ sent, delivered: LEAD }) });
		const plan = await halfContract(who);
		await who.peer.call({ action: "contract", card: "1", path: plan, verify: VERIFY });
		expect(sent).toHaveLength(1);

		// The same four lines again: the store writes nothing, so the lead is not asked twice.
		const again = await who.peer.call({ action: "contract", card: "1", path: plan, verify: VERIFY });
		expect(again.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(again.details.told).toBeUndefined();
	});

	test("asks again when a changed line drops the signature it had", async () => {
		const sent: Sent[] = [];
		const who = bench({ notify: signBus({ sent, delivered: LEAD }) });
		const plan = await halfContract(who);
		await who.peer.call({ action: "contract", card: "1", path: plan, verify: VERIFY });
		await who.lead.call({ action: "approve", card: "1" });
		expect((await who.peer.call({ action: "list", card: "1" })).details.card?.contract?.approved).toBeDefined();
		sent.length = 0;

		// The wording moved, so the sign names a contract that no longer exists: the lead is asked
		// again rather than left holding an approval for the old lines.
		const changed = await who.peer.call({ action: "contract", card: "1", path: plan, goal: "g2" });
		expect(changed.isError).toBeFalsy();
		expect(changed.details.card?.contract?.approved).toBeUndefined();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.text).toContain("Contract ready");
	});

	test("says nothing on a board that names no lead", async () => {
		const sent: Sent[] = [];
		const who = bench({ notify: signBus({ sent }) }, { lead: "" });
		const plan = await halfContract(who);
		const done = await who.peer.call({ action: "contract", card: "1", path: plan, verify: VERIFY });
		expect(done.isError).toBeFalsy();
		// Nothing can sign it as a session, so there is no gate to announce: the person's door is
		// the only one, and the card's own state is what says it is open.
		expect(sent).toHaveLength(0);
		expect(done.details.told).toBeUndefined();
	});

	test("a send that fails is a line on the result, never the write", async () => {
		const who = bench({ notify: signBus({ fail: "the session bus is not loaded" }) });
		const plan = await halfContract(who);
		const done = await who.peer.call({ action: "contract", card: "1", path: plan, verify: VERIFY });
		expect(done.isError).toBeFalsy();
		// The contract is on the card, which is the durable half; the message is the wake-up.
		expect(done.details.card?.contract?.verify).toBe(VERIFY);
		expect(resultText(done)).toContain("was not told (the session bus is not loaded)");
		expect(done.details.told).toContain("was not told");
	});

	test("reaches the lead by its live record, and says when it is not listening", async () => {
		const sent: Sent[] = [];
		const who = bench({ notify: signBus({ sent, delivered: LEAD }) });
		// The lead renamed itself: the record holds the label, so the id it answers by now is what
		// the message must be addressed with. Its watch is off, which the result has to say.
		await onBus(who.lead, { id: "s-new", label: LEAD, watching: { armed: false, wake: false } });
		const plan = await halfContract(who);
		const done = await who.peer.call({ action: "contract", card: "1", path: plan, verify: VERIFY });
		expect(sent[0]?.to).toBe("s-new");
		expect(resultText(done)).toContain("not listening: it reads this at its next turn");
	});
});
