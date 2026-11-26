/**
 * The leave seam's caller side: what an extension asks the bus, and what it is told when the bus is
 * not there.
 *
 * `team` asks through this module because a command has no `ctx.executeTool`, so the one thing a
 * suite here owes is the handshake itself: the channel, the payload, and the sentence a session
 * with no bus loaded reads instead of a promise that never settles. The leave's own effects are the
 * bus's, in `extensions/session-bus/leave.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { leave, type TeamLeaveRequest, TEAM_LEAVE_REQUEST } from "./session-tool.ts";

/**
 * A host whose `session` tool is (or is not) registered, and whose request reaches `answer`.
 *
 * The same double `session-tool.test.ts` builds for the join: a leave is one more payload on one
 * more channel, so a case says only what its answer is.
 */
function host<R>(answer?: (request: R) => void, options: { loaded?: boolean } = {}) {
	const emitted: Array<{ channel: string; data: unknown }> = [];
	return {
		emitted,
		host: {
			events: {
				on: () => () => {},
				emit: (channel: string, data: unknown) => {
					emitted.push({ channel, data });
					if (answer) answer(data as R);
				},
			},
			getAllTools: () => (options.loaded === false ? [] : [{ name: "session" }]),
		},
	};
}

describe("leave", () => {
	test("asks the bus once, on its own channel, and reports what it gave up", async () => {
		const { host: pi, emitted } = host<TeamLeaveRequest>((request) =>
			request.respond({ ok: true, label: "tom", released: ["src/api/pay.ts"] }),
		);
		const ctx = { cwd: "/repo/peer" } as unknown as ExtensionContext;

		expect(await leave(pi as never, ctx)).toEqual({
			ok: true,
			label: "tom",
			released: ["src/api/pay.ts"],
		});
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.channel).toBe(TEAM_LEAVE_REQUEST);
		// The payload carries the context the bus answers through, and nothing else: a leave names
		// no label, because it is this session's own name that goes.
		expect((emitted[0]?.data as TeamLeaveRequest).ctx).toBe(ctx);
	});

	test("carries a bus that was on no bus to leave, rather than reading it as a refusal", async () => {
		const { host: pi } = host<TeamLeaveRequest>((request) => request.respond({ ok: true, released: [] }));

		expect(await leave(pi as never, {} as never)).toEqual({ ok: true, released: [] });
	});

	test("answers with the bus's sentence when it refuses, and takes the first answer only", async () => {
		const { host: pi } = host<TeamLeaveRequest>((request) => {
			request.respond({ ok: false, error: "the bus is not started." });
			request.respond({ ok: true, released: [] });
		});

		expect(await leave(pi as never, {} as never)).toEqual({ ok: false, error: "the bus is not started." });
	});

	test("says the bus is not loaded instead of waiting for a listener that is not there", async () => {
		const { host: pi, emitted } = host<TeamLeaveRequest>(undefined, { loaded: false });

		expect(await leave(pi as never, {} as never)).toEqual({
			ok: false,
			error: "the session bus is not loaded",
		});
		expect(emitted).toEqual([]);
	});
});
