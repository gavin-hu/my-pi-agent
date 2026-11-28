/**
 * The `team` verb that asks a peer a question: the one with no card behind it.
 *
 * `ask` writes no card and moves nothing, so what its cases assert is the message it sends
 * and the two facts a send cannot tell: who will be woken for it, and what the answer is
 * waiting on. It lives apart from `handoff.test.ts` — the two verbs that move a card and
 * then record it — because a question is answered by a turn, not by a write.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { MAX_MESSAGE_TEXT } from "../../lib/session-mail.ts";
import { type Peer } from "../../lib/session-tool.ts";
import { resultText } from "../../test/helpers/fixtures/board.ts";
import { type TeamSuiteOptions, teamSuite } from "../../test/helpers/fixtures/team.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { askText } from "./dispatch.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One tool over fresh directories, tracked for teardown by this file's hook. */
const harness = (options: TeamSuiteOptions = {}) => teamSuite(temps.track, options);

describe("ask", () => {
	test("joins before it sends, so the answer has a name to reach", async () => {
		const board = harness({
			duringSend: () => {
				// The message names this session as the reply route, so an answer sent from the peer's
				// next turn has to find a label the bus holds — not one a join lands later.
				expect(board.joined).toHaveLength(1);
			},
		});
		const self = await board.me();
		const result = await board.call({ action: "ask", to: "billing-core", question: "any blockers?" });
		expect(result.isError).toBeFalsy();
		expect(board.sent).toHaveLength(1);
		expect(board.joined).toEqual([self.label]);
	});

	test("a join that does not land refuses the question, and sends nothing", async () => {
		const { call, sent } = harness({ joinFails: "the session bus is not loaded" });
		const result = await call({ action: "ask", to: "billing-core", question: "any blockers?" });
		expect(result.isError).toBe(true);
		expect(sent).toEqual([]);
		expect(resultText(result)).toContain("the ask did not reach billing-core: this session is not on the team");
		// The remedy is the join's, not a blanket `/team join`: with no bus loaded that door refuses
		// in the same words, so the sentence names the switch instead.
		expect(resultText(result)).toContain("Turn the `session-bus` extension on in `/bytefly`.");
	});

	test("sends the question to the one peer, and reports where the answer arrives", async () => {
		const { call, me, sent } = harness();
		const self = await me();
		const result = await call({ action: "ask", to: "billing-core", question: "is #162 ready for review?" });
		expect(result.isError).toBeFalsy();
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ kind: "ask", to: "billing-core" });
		// The one kind with no protocol of its own: the ask names itself, the reply target is written
		// out, and the peer is told nothing is waiting on it. This roster holds no record of the asker,
		// so the route has to say it is a label — the fallback, admitted rather than disguised.
		const ask = result.details.askId ?? "?";
		expect(ask).toMatch(/^a[0-9a-f]{6}$/);
		expect(sent[0]?.text).toContain(`Ask ${ask}: is #162 ready for review?`);
		expect(sent[0]?.text).toContain(`session send to "${self.label}" (the label`);
		expect(sent[0]?.text).toContain(`re: ${ask}`);
		expect(resultText(result)).toContain(`Asked billing-core — ask ${ask}.`);
		expect(resultText(result)).toContain("nothing is waiting on it");
		// No card behind it: an ask writes nothing, so there is nothing to report.
		expect(result.details.card).toBeUndefined();
	});

	test("routes the answer to this session's id when the roster holds it", async () => {
		// The id is the point of the card: it survives this session renaming itself, and a peer that
		// sends to it reaches the same session a rename would have hidden behind a stale label.
		const peers: Peer[] = [];
		const { call, me, sent } = harness({ peers });
		const self = await me();
		// The record under this session's own id, which is what the roster writes when it joins.
		const mine = self.id ?? "s-7f3a91c2";
		peers.push(
			{ id: "s-billing-core", label: "billing-core", listening: true },
			{ id: mine, label: self.label, listening: true },
		);
		const result = await call({ action: "ask", to: "billing-core", question: "any blockers?" });
		const ask = result.details.askId ?? "?";
		expect(sent[0]?.text).toContain(`session send to "${mine}" (a session id, not a label)`);
		expect(sent[0]?.text).toContain(`re: ${ask}`);
	});

	test("mints a different id for every ask", async () => {
		const { call } = harness();
		await call({ action: "ask", to: "billing-core", question: "first?" });
		const again = await call({ action: "ask", to: "billing-core", question: "second?" });
		expect(again.details.askId).not.toBe("?");
		expect(again.details.askId).toMatch(/^a[0-9a-f]{6}$/);
	});

	test("asks how it is going when the lead names no question", async () => {
		const { call, sent } = harness();
		await call({ action: "ask", to: "billing-web" });
		expect(sent[0]?.text).toContain(": how is it going?");
	});

	test("names a peer that will read it at its next turn rather than being woken", async () => {
		const { call } = harness({ peers: [{ id: "s-billing-core", label: "billing-core", listening: false }] });
		const result = await call({ action: "ask", to: "billing-core", question: "any blockers?" });
		expect(resultText(result)).toContain("Not listening: billing-core — it reads this at its next turn.");
	});

	test("refuses a missing peer and a question to itself, sending nothing", async () => {
		const { call, me, sent } = harness();
		const self = await me();
		expect(resultText(await call({ action: "ask", question: "hello?" }))).toContain("ask needs a peer");
		const own = await call({ action: "ask", to: self.label, question: "hello?" });
		expect(resultText(own)).toContain("the round already says what you hold");
		expect(sent).toEqual([]);
	});

	test("refuses the bus's wildcard before the join, so nothing is sent and nothing is joined", async () => {
		const { call, joined, sent } = harness();
		const result = await call({ action: "ask", to: "*", question: "any blockers?" });
		expect(result.isError).toBe(true);
		expect(result.details.error).toBe("ask reaches one peer; `*` is `offer`'s broadcast to every live session.");
		// The tool's sentence, not the transport's: reaching `a broadcast needs kind: event` meant the join
		// had already run, so the session was on the team for a question that was never asked.
		expect(resultText(result)).not.toContain("broadcast needs kind");
		expect(sent).toEqual([]);
		expect(joined).toEqual([]);
	});

	test("an ask that names a card is refused by the field table", async () => {
		const { call, sent } = harness();
		const result = await call({ action: "ask", card: "1", to: "billing-core" });
		// Two verbs read `card`, so the refusal names both rather than the nearest one.
		expect(result.details.error).toBe("ask does not act on card: `assign` and `offer` take it.");
		expect(sent).toEqual([]);
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
