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
import { fakeCtx } from "../../test/helpers/context.ts";
import { stubSession } from "../../test/helpers/board.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import board from "./index.ts";
import type { BoardPage } from "./page.ts";

/** A page that records its lifecycle. */
function stubPage(calls: string[]): BoardPage {
	return {
		start: async () => {
			calls.push("start");
			return {
				kind: "served",
				seat: "team-lead",
				port: 1,
				url: "http://127.0.0.1:1/",
				repo: "my-pi-agent",
				where: "x",
			};
		},
		stop: async () => {
			calls.push("stop");
			return true;
		},
		status: async () => ({ running: false }),
		dropStale: async () => "gone",
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
}

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
	 * The door's seat read, as the guard a tool call actually meets.
	 *
	 * `seatHeld` is not exported, and should not be: what a reader needs is that a branch holding the
	 * seat narrows the tools and that a planning or an auto branch narrows nothing. Both compares
	 * inside the factory are `lib/mode-state.ts`'s readers — `holdsSeat` and `isPlanModeEnabled` — so
	 * this case fails if either is derived by hand again, or if the readers are wired the wrong way
	 * round: swapping them leaves the seated branch unanswered and the planning one blocked.
	 *
	 * Three branches through **one** factory on purpose: the module import is cached (`branchState ?==`
	 * on the promise, keyed only on "has it loaded"), so a reading frozen at the first question would
	 * show up here as the second and third branches answering like the first.
	 */
	test("narrows the tools on a seat branch, and on neither of the other two modes", async () => {
		const SEAT = [{ type: "custom", customType: LEAD_MODE_ENTRY_TYPE, data: { enabled: true } }];
		const PLANNING = [{ type: "custom", customType: PLAN_MODE_ENTRY_TYPE, data: { enabled: true } }];
		await withEnv(ENABLED, async () => {
			const fake = createFakePi();
			board(fake.pi, { session: stubSession(), page: stubPage([]) });
			const [guard] = fake.handlers.get("tool_call") ?? [];
			if (guard === undefined) throw new Error("the factory registered no tool guard");
			const call = { toolName: "write", input: { path: "a.md", content: "x" } };

			// A seat: the door opens, and the call is refused by the seat's own policy.
			expect(await guard(call, fakeCtx({ branch: SEAT }).ctx)).toMatchObject({ block: true });

			// Planning and auto: the door answers nothing, so the guard has no opinion to add.
			expect(await guard(call, fakeCtx({ branch: PLANNING }).ctx)).toBeUndefined();
			expect(await guard(call, fakeCtx().ctx)).toBeUndefined();
		});
	});
});
