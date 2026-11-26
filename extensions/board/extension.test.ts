/**
 * The factory: what it registers, what it refuses to register, and what a shutdown
 * closes.
 *
 * The two properties that matter are that it registers without a session (a tool and
 * a command, no listener, no socket), and that `PI_DISABLED_EXTENSIONS` still stops it.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { LEAD_MODE_ENTRY_TYPE, PLAN_MODE_ENTRY_TYPE } from "../../lib/mode-state.ts";
import { STATUS_KEYS } from "../../lib/tui/glyphs.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import { stubSession } from "../../test/helpers/board.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import board from "./index.ts";
import type { BoardPage, PageStart } from "./page.ts";

/** What `/board` answers from `start`, and what `status` says. */
interface StubPageOptions {
	started?: PageStart;
	running?: boolean;
}

/** A page that records its lifecycle. */
function stubPage(calls: string[], options: StubPageOptions = {}): BoardPage {
	const seat = { seat: "team-lead", port: 1, url: "http://127.0.0.1:1/", repo: "my-pi-agent", where: "x" };
	const served: PageStart = options.started ?? { kind: "served", ...seat };
	return {
		start: async () => {
			calls.push("start");
			return served;
		},
		stop: async () => {
			calls.push("stop");
			return true;
		},
		status: async () => (options.running === true ? { running: true, ...seat } : { running: false }),
		dropStale: async () => "gone",
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
}

/**
 * A session whose seat is whatever the page last told it.
 *
 * The two halves `reconcile` asks are separate on purpose — the branch says `lead` and this says
 * whether a page is served here — so a case about one can hold the other still.
 */
function seatSession(): BoardSession & { served(): string | undefined } {
	let served: string | undefined;
	return {
		...stubSession(),
		serving: () => served,
		serve: (next) => {
			served = next;
		},
		served: () => served,
	};
}

/** The two entries a branch can carry, and the call every guard case makes. */
const SEAT = [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } }];
const PLANNING = [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }];
const CALL = { toolName: "write", input: { path: "a.md", content: "x" } };

/**
 * The environment every test here wants: the empty disable list, so the factory
 * registers.
 */
const ENABLED = { [ENV_DISABLED_EXTENSIONS]: "" };

describe("the board extension", () => {
	test("registers one tool and one command, and starts nothing", async () => {
		await withEnv(ENABLED, () => {
			const fake = createFakePi();
			const calls: string[] = [];
			board(fake.pi, { session: stubSession(), page: stubPage(calls) });
			expect([...fake.tools.keys()]).toEqual(["board"]);
			expect([...fake.commands.keys()]).toEqual(["board"]);
			expect(calls).toEqual([]);
		});
	});

	test("closes the page on session shutdown", async () => {
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			const calls: string[] = [];
			board(fake.pi, { session: stubSession(), page: stubPage(calls) });
			const handlers = fake.handlers.get("session_shutdown") ?? [];
			const { ctx } = fakeCtx();
			for (const handler of handlers) await handler({}, ctx);
			expect(calls).toEqual(["closeAll"]);
		});
	});

	test("registers nothing when the package disabled it", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "board" }, () => {
			const fake = createFakePi();
			board(fake.pi, { session: stubSession(), page: stubPage([]) });
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
		});
	});

	/**
	 * The seat's one reconcile, as the guard a tool call actually meets.
	 *
	 * Every case drives the real `tool_call` handler rather than `isEnabled()`: tonight's defect was
	 * the two disagreeing, and a case written against the runtime alone would have passed while the
	 * model was still refused. The branch is the double's own array, so a case can hold it still
	 * across a write that never landed — which is the state the seat was found in.
	 */
	test("narrows the tools only while the seat is served here", async () => {
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			const session = seatSession();
			board(fake.pi, { session, page: stubPage([]) });
			const [guard] = fake.handlers.get("tool_call") ?? [];
			if (guard === undefined) throw new Error("the factory registered no tool guard");

			// A seat branch with no page here — the resume case: no leash, and nothing to explain.
			expect(await guard(CALL, fakeCtx({ branch: SEAT }).ctx)).toBeUndefined();

			// The page served here: the branch is a seat, and the call is refused by its policy.
			session.serve("team-lead");
			expect(await guard(CALL, fakeCtx({ branch: SEAT }).ctx)).toMatchObject({ block: true });

			// Planning or auto: the door has no opinion to add.
			expect(await guard(CALL, fakeCtx({ branch: PLANNING }).ctx)).toBeUndefined();
			expect(await guard(CALL, fakeCtx().ctx)).toBeUndefined();
		});
	});

	test("/board stop ends the seat for the next call, whatever the branch says", async () => {
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			const session = seatSession();
			session.serve("team-lead");
			board(fake.pi, { session, page: stubPage([]) });
			const [guard] = fake.handlers.get("tool_call") ?? [];
			const command = fake.commands.get("board");
			if (guard === undefined || command === undefined) throw new Error("the factory registered no doors");

			// Armed: the branch says `lead` and the page is served here.
			expect(await guard(CALL, fakeCtx({ branch: SEAT }).ctx)).toMatchObject({ block: true });

			// The exit, typed in the session. The branch is this double's array and takes no write —
			// tonight's state, where the off-switch said it worked and the leash stayed on.
			await command.handler("stop", fakeCtx({ branch: SEAT }).ctx);
			expect(await guard(CALL, fakeCtx({ branch: SEAT }).ctx)).toBeUndefined();
			expect(fake.entries.at(-1)?.customType).toBe(LEAD_MODE_ENTRY_TYPE);
			expect((fake.entries.at(-1)?.data as { enabled?: unknown }).enabled).toBe(false);
		});
	});

	test("a turn after the page closes puts the tools back", async () => {
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			const session = seatSession();
			session.serve("team-lead");
			board(fake.pi, { session, page: stubPage([]) });
			const [guard] = fake.handlers.get("tool_call") ?? [];
			const [turn] = fake.handlers.get("before_agent_start") ?? [];
			if (guard === undefined || turn === undefined) throw new Error("the factory registered no doors");
			const { ctx } = fakeCtx({ branch: SEAT });
			expect(await guard(CALL, ctx)).toMatchObject({ block: true });

			// The page closes itself (the idle grace) and nobody tells the session: the turn asks.
			session.serve(undefined);
			await turn({}, ctx);
			expect(await guard(CALL, ctx)).toBeUndefined();
			expect(ctx.statusCalls.at(-1)).toEqual({ key: STATUS_KEYS.leadMode, text: undefined });
		});
	});

	test("a /tree that lands off the seat puts the tools back", async () => {
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			const session = seatSession();
			session.serve("team-lead");
			board(fake.pi, { session, page: stubPage([]) });
			const [guard] = fake.handlers.get("tool_call") ?? [];
			const [tree] = fake.handlers.get("session_tree") ?? [];
			if (guard === undefined || tree === undefined) throw new Error("the factory registered no doors");
			const branch = [...SEAT];
			const { ctx } = fakeCtx({ branch });
			expect(await guard(CALL, ctx)).toMatchObject({ block: true });

			// The branch it lands on never named the seat: the host put that branch's set back.
			branch.splice(0);
			await tree({}, ctx);
			expect(await guard(CALL, ctx)).toBeUndefined();
			expect(ctx.statusCalls.at(-1)).toEqual({ key: STATUS_KEYS.leadMode, text: undefined });
		});
	});

	test("/board stop ends the page and the seat it implied", async () => {
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			const session = seatSession();
			session.serve("team-lead");
			const calls: string[] = [];
			board(fake.pi, { session, page: stubPage(calls, { running: true }) });
			const [guard] = fake.handlers.get("tool_call") ?? [];
			const command = fake.commands.get("board");
			if (guard === undefined || command === undefined) throw new Error("the factory registered no doors");
			const { ctx, notifications } = fakeCtx({ branch: SEAT });
			expect(await guard(CALL, ctx)).toMatchObject({ block: true });

			await command.handler("stop", ctx);
			expect(calls).toContain("stop");
			expect(session.served()).toBeUndefined();
			expect(notifications.at(-1)).toBe("board: stopped · lead mode off");
			expect(await guard(CALL, ctx)).toBeUndefined();
		});
	});

	test("an attached /board stands the session down and leaves its seat", async () => {
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			const session = seatSession();
			session.serve("team-lead");
			const team = {
				join: async () => ({ ok: true as const, label: "team-lead", watching: { armed: true, wake: true } }),
			};
			board(fake.pi, {
				session,
				team,
				page: stubPage([], {
					started: {
						kind: "attached",
						seat: "gavin",
						port: 2,
						url: "http://127.0.0.1:2/",
						repo: "my-pi-agent",
						where: "x",
					},
				}),
			});
			const [guard] = fake.handlers.get("tool_call") ?? [];
			const command = fake.commands.get("board");
			if (guard === undefined || command === undefined) throw new Error("the factory registered no doors");
			const { ctx, notifications } = fakeCtx({ branch: SEAT });
			expect(await guard(CALL, ctx)).toMatchObject({ block: true });

			await command.handler("", ctx);
			expect(session.served()).toBeUndefined();
			expect(notifications.at(-1)).toContain("lead mode off");
			expect(await guard(CALL, ctx)).toBeUndefined();
		});
	});

	/**
	 * The tool a session is offered, which is the team's own question asked at a turn start.
	 *
	 * The default double reads no bus, so the solo board is the case these helpers start from; a case
	 * about membership hands in a roster that holds this session, or one that does not.
	 */
	/** The clock the records a case seeds are judged against. */
	const NOW = 50_000;

	describe("the tool a session is offered", () => {
		/** A session whose roster is the one a case names, with a clock its records are judged by. */
		function onClock(records: Array<{ id: string; label: string; lastSeen: number }>): BoardSession {
			return {
				...stubSession(),
				now: () => NOW,
				roster: async () => records.map((record) => ({ ...record, mode: "tui", mail: 0 })),
			};
		}

		/** One turn start, as the host runs it: every handler, in order. */
		async function turn(fake: ReturnType<typeof createFakePi>, ctx: unknown): Promise<void> {
			for (const handler of fake.handlers.get("before_agent_start") ?? []) await handler({}, ctx);
		}

		/** The same session, serving the page as the seat: the half `reconcile` reads besides the branch. */
		function seated(session: BoardSession): BoardSession {
			return { ...session, serving: () => "team-lead" };
		}

		/** A board whose bus is loaded: the `session` tool is the one way `busLoaded` knows. */
		function busBoard(session: BoardSession) {
			const fake = createFakePi();
			fake.pi.registerTool({ name: "session" });
			board(fake.pi, { session, page: stubPage([]) });
			return fake;
		}

		test("is offered only once a turn finds this session on the team", async () => {
			await withEnv(ENABLED, async () => {
				const { ctx } = fakeCtx({ sessionId: "s-lead" });
				const cold = busBoard(onClock([]));
				await turn(cold, ctx);
				expect(cold.pi.getActiveTools()).not.toContain("board");

				const joined = busBoard(onClock([{ id: "s-lead", label: "billing-lead", lastSeen: NOW }]));
				await turn(joined, ctx);
				expect(joined.pi.getActiveTools()).toContain("board");
			});
		});

		test("is withdrawn the turn after the record goes, and comes back when it does", async () => {
			await withEnv(ENABLED, async () => {
				const records: Array<{ id: string; label: string; lastSeen: number }> = [
					{ id: "s-lead", label: "billing-lead", lastSeen: NOW },
				];
				const fake = busBoard(onClock(records));
				const { ctx } = fakeCtx({ sessionId: "s-lead" });
				await turn(fake, ctx);
				expect(fake.pi.getActiveTools()).toContain("board");
				// A peer's `/team exit` on this id, or a record the heartbeat pruned.
				records.length = 0;
				await turn(fake, ctx);
				expect(fake.pi.getActiveTools()).not.toContain("board");
			});
		});

		test("is offered with no bus loaded, because a solo board is still a work list", async () => {
			await withEnv(ENABLED, async () => {
				const fake = createFakePi();
				board(fake.pi, { session: stubSession(), page: stubPage([]) });
				await turn(fake, fakeCtx().ctx);
				expect(fake.pi.getActiveTools()).toContain("board");
			});
		});

		test("keeps the seat's narrowing and the offer apart: a lead on no team gets neither tool", async () => {
			await withEnv(ENABLED, async () => {
				const fake = busBoard(seated(onClock([])));
				const { ctx } = fakeCtx({ branch: SEAT, sessionId: "s-lead" });
				await turn(fake, ctx);
				// The seat entered — `plan` is its verb — and the offer did not survive it.
				expect(fake.pi.getActiveTools()).toContain("plan");
				expect(fake.pi.getActiveTools()).not.toContain("board");
			});
		});

		test("offers the tool to a lead on the team, after the seat has narrowed the set", async () => {
			await withEnv(ENABLED, async () => {
				const fake = busBoard(seated(onClock([{ id: "s-lead", label: "billing-lead", lastSeen: NOW }])));
				const { ctx } = fakeCtx({ branch: SEAT, sessionId: "s-lead" });
				// The host's set has no `board`, so this passes only if the sync runs after the seat's
				// early return — which is the ordering the handler has to keep.
				await turn(fake, ctx);
				expect(fake.pi.getActiveTools()).toContain("plan");
				expect(fake.pi.getActiveTools()).toContain("board");
			});
		});
	});
});
