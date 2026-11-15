/**
 * The three fields one send carries: the key that folds a resend, the id it answers, and the card
 * it is about.
 *
 * The nested call is the one path `board` and `team` take, and a field a caller sets but the seam
 * drops is a field nobody gets — which is what this suite exists to catch. `session-tool.test.ts`
 * owns the rest of the caller side (the two transports, the answers, and the not-delivered line).
 *
 * It is its own suite because that file is at the suite bar.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../test/helpers/context.ts";
import { send } from "./session-tool.ts";

/** A tool context whose nested call is recorded, and answers with one delivered label. */
function nestedHost() {
	const calls: Array<Record<string, unknown>> = [];
	const { ctx } = fakeCtx({
		extra: {
			executeTool: async (name: string, args: Record<string, unknown>) => {
				calls.push({ name, ...args });
				return { result: { content: [], details: { action: "send", delivered: ["billing-core"] } } };
			},
		},
	});
	return { ctx, calls };
}

describe("the fields a send carries", () => {
	test("the nested call passes the key, the id it answers and the card it is about", async () => {
		const { ctx, calls } = nestedHost();
		await send({ getAllTools: () => [{ name: "session" }] } as never, ctx, {
			kind: "event",
			to: "billing-core",
			text: "signed",
			key: "sign:4",
			replyTo: "a1b2c3",
			about: "4",
		});
		expect(calls).toEqual([
			{
				name: "session",
				action: "send",
				kind: "event",
				to: "billing-core",
				text: "signed",
				key: "sign:4",
				replyTo: "a1b2c3",
				about: "4",
			},
		]);
	});

	test("a send with no fields asks for none, rather than sending them undefined", async () => {
		const { ctx, calls } = nestedHost();
		await send({ getAllTools: () => [{ name: "session" }] } as never, ctx, {
			kind: "ask",
			to: "billing-core",
			text: "how is it going?",
		});
		expect(calls).toEqual([
			{ name: "session", action: "send", kind: "ask", to: "billing-core", text: "how is it going?" },
		]);
	});
});
