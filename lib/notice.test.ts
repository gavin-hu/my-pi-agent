/**
 * The retention rule for injected context: keep only the newest own message, or
 * drop them all when the owner says its injection is no longer current.
 *
 * Beside the module rather than in `core.test.ts`, whose height is a recorded
 * ceiling: the rule is its own subject now that five extensions call it.
 *
 * The cases use a plain message shape, not `AgentMessage`: the rule is generic
 * over the message type, and the point of the predicate parameter is that each
 * caller keeps its own narrowing.
 */

import { describe, expect, test } from "bun:test";
import { retainNewest } from "./notice.ts";

interface Injected {
	kind: "own" | "user" | "other";
	id: string;
}

/** One message the caller owns. */
function own(id: string): Injected {
	return { kind: "own", id };
}

/** The predicate a `context` handler passes: which messages are its own. */
function isOwn(message: Injected): boolean {
	return message.kind === "own";
}

describe("retainNewest", () => {
	test("keeps only the newest own message, in place and by reference", () => {
		const messages = [own("a"), { kind: "user", id: "u" } satisfies Injected, own("b")];
		const kept = retainNewest(messages, isOwn);
		expect(kept?.map((message) => message.id)).toEqual(["u", "b"]);
		// Identity, not equality: the host drops the others and keeps this object.
		expect(kept?.[1]).toBe(messages[2]);
	});

	test("leaves another owner's messages and real user messages untouched", () => {
		const messages = [own("a"), { kind: "other", id: "o" } satisfies Injected, own("b")];
		const kept = retainNewest(messages, isOwn);
		expect(kept?.map((message) => message.kind)).toEqual(["other", "own"]);
		expect(kept).toContain(messages[1]);
	});

	test("answers undefined when there is nothing to drop", () => {
		expect(retainNewest([{ kind: "user", id: "u" } satisfies Injected], isOwn)).toBeUndefined();
		expect(retainNewest([own("a")], isOwn)).toBeUndefined();
	});

	test("drops every own message once the owner is inactive", () => {
		const messages = [
			{ kind: "user", id: "u" } satisfies Injected,
			own("a"),
			{ kind: "other", id: "o" } satisfies Injected,
			own("b"),
		];
		const kept = retainNewest(messages, isOwn, { active: false });
		expect(kept?.map((message) => message.kind)).toEqual(["user", "other"]);
		expect(kept).toContain(messages[0]);
	});

	test("an inactive owner with none of its own answers undefined", () => {
		expect(retainNewest([{ kind: "user", id: "u" } satisfies Injected], isOwn, { active: false })).toBeUndefined();
	});
});
