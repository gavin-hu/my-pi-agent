/**
 * The session-tool client: what a caller gets back, and what it never gets.
 *
 * `join` is an in-process request, so its cases drive a fake host that answers on the
 * channel; `listPeers` and `send` are nested calls, so theirs record what `executeTool`
 * was asked. Both halves share one rule: nothing throws.
 */

import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../test/helpers/context.ts";
import { join, listPeers, MAX_MESSAGE_TEXT, send, TEAM_JOIN_REQUEST, type TeamJoinRequest } from "./session-tool.ts";

/** What one nested call answers. */
type Reply = { isError?: boolean; result?: unknown };

/** A context whose nested calls record what they were asked and answer with `reply`. */
function client(reply: (args: Record<string, unknown>) => Reply | Promise<Reply>) {
	const calls: Array<Record<string, unknown>> = [];
	const { ctx } = fakeCtx({
		extra: {
			executeTool: async (name: string, args: Record<string, unknown>) => {
				calls.push({ name, ...args });
				return await reply(args);
			},
		},
	});
	return { ctx, calls };
}

/** A clean answer with these details. */
const ok = (details: unknown): Reply => ({ result: { content: [], details } });

/** A host whose `session` tool is (or is not) registered, and whose request reaches `answer`. */
function host(answer?: (request: TeamJoinRequest) => void, options: { loaded?: boolean } = {}) {
	const emitted: Array<{ channel: string; data: unknown }> = [];
	return {
		emitted,
		host: {
			events: {
				on: () => () => {},
				emit: (channel: string, data: unknown) => {
					emitted.push({ channel, data });
					if (answer) answer(data as TeamJoinRequest);
				},
			},
			getAllTools: () => (options.loaded === false ? [] : [{ name: "session" }]),
		},
	};
}

describe("join", () => {
	test("asks the bus once and reports the label and the watch it landed on", async () => {
		const { host: pi, emitted } = host((request) =>
			request.respond({ ok: true, label: "billing-core", watching: { armed: true, wake: false } }),
		);
		const result = await join(pi as never, {} as never, { label: "billing-core" });
		expect(result).toEqual({ ok: true, label: "billing-core", watching: { armed: true, wake: false } });
		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.channel).toBe(TEAM_JOIN_REQUEST);
		expect((emitted[0]?.data as TeamJoinRequest).input).toEqual({ label: "billing-core" });
	});

	test("carries the wake and listen options through", async () => {
		const { host: pi, emitted } = host((request) =>
			request.respond({ ok: true, label: "frontend", watching: { armed: false, wake: false } }),
		);
		await join(pi as never, {} as never, { listen: false });
		await join(pi as never, {} as never, { wake: true });
		await join(pi as never, {} as never);
		expect(emitted.map((entry) => (entry.data as TeamJoinRequest).input)).toEqual([
			{ listen: false },
			{ wake: true },
			{},
		]);
	});

	test("answers with the bus's sentence when it refuses, and takes the first answer only", async () => {
		const { host: pi } = host((request) => {
			request.respond({ ok: false, error: "already in use" });
			request.respond({ ok: true, label: "later", watching: { armed: true, wake: false } });
		});
		expect(await join(pi as never, {} as never, { label: "taken" })).toEqual({ ok: false, error: "already in use" });
	});

	test("says the bus is not loaded instead of waiting for a listener that is not there", async () => {
		const { host: pi, emitted } = host(undefined, { loaded: false });
		expect(await join(pi as never, {} as never, { label: "billing-core" })).toEqual({
			ok: false,
			error: "the session bus is not loaded",
		});
		expect(emitted).toEqual([]);
	});
});

describe("listPeers", () => {
	test("maps the status rows, and says listening only when the record does", async () => {
		const { ctx, calls } = client(() =>
			ok({
				status: {
					sessions: [
						{ id: "s-1", label: "billing-core", unread: 0, watching: { armed: true, wake: false } },
						{ id: "s-2", label: "billing-web", unread: 2 },
						{ id: "s-3", label: "bad-shape", watching: "on" },
						{ label: "no id" },
					],
				},
			}),
		);
		expect(await listPeers(ctx)).toEqual([
			{ id: "s-1", label: "billing-core", listening: true },
			{ id: "s-2", label: "billing-web" },
			{ id: "s-3", label: "bad-shape" },
		]);
		expect(calls).toEqual([{ name: "session", action: "status" }]);
	});

	test("answers nothing when the bus cannot say, which is not an empty team", async () => {
		const failed = client(() => ({ isError: true, result: { content: [] } }));
		expect(await listPeers(failed.ctx)).toBeUndefined();
		const unreadable = client(() => ok({ status: "nonsense" }));
		expect(await listPeers(unreadable.ctx)).toBeUndefined();
		const noStatus = client(() => ok({}));
		expect(await listPeers(noStatus.ctx)).toBeUndefined();
	});

	test("a nested call that rejects is nothing to say, because an unregistered bus throws", async () => {
		const ctx = {
			executeTool: async () => {
				throw new Error("the session tool is not available");
			},
		};
		expect(await listPeers(ctx as never)).toBeUndefined();
	});
});

describe("send", () => {
	test("sends the kind it was given and reports the labels written for", async () => {
		const { ctx, calls } = client(() => ok({ action: "send", delivered: ["billing-core", 7] }));
		expect(await send(ctx, { kind: "event", to: "*", text: "handoff text" })).toEqual({
			ok: true,
			delivered: ["billing-core"],
		});
		expect(calls).toEqual([{ name: "session", action: "send", kind: "event", to: "*", text: "handoff text" }]);
	});

	test("reports a failed send as its sentence", async () => {
		const { ctx } = client(() => ({
			isError: true,
			result: { content: [{ type: "text", text: "no active session." }] },
		}));
		expect(await send(ctx, { kind: "handoff", to: "ghost", text: "x" })).toEqual({
			ok: false,
			error: "no active session.",
		});
	});

	test("a nested call that rejects is a sentence, because an unregistered bus throws", async () => {
		const ctx = {
			executeTool: async () => {
				throw new Error("the session tool is not available");
			},
		};
		expect(await send(ctx as never, { kind: "event", to: "*", text: "x" })).toEqual({
			ok: false,
			error: "the session tool is not available",
		});
	});
});

test("the text cap is the 4,000 characters the docs state", () => {
	expect(MAX_MESSAGE_TEXT).toBe(4_000);
});
