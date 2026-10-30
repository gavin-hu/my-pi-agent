/**
 * The factory: what it registers, what it refuses to register, and what a shutdown
 * closes.
 *
 * The extension is opt-in, so the two properties that matter are that it registers
 * nothing until the session asks for it, and that it registers without a session
 * (a tool and a command, no listener, no socket) once it does.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS, ENV_ENABLED_EXTENSIONS } from "../../lib/env.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import board from "./index.ts";
import type { BoardPage } from "./page.ts";
import type { BoardSession } from "../../lib/board/session.ts";

/** A session that never touches the disk. */
function stubSession(): BoardSession {
	return {
		store: () => {
			throw new Error("the factory must not open a store");
		},
		who: async () => ({ label: "billing-lead" }),
		now: () => 0,
		busDir: async () => {
			throw new Error("the factory must not read the bus");
		},
		planDir: async () => {
			throw new Error("the factory must not read the plan store");
		},
		serving: () => undefined,
		serve: () => {},
		team: { last: () => undefined, record: () => {} },
	};
}

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
		dropStale: async () => false,
		closeAll: async () => {
			calls.push("closeAll");
		},
	};
}

/**
 * The environment that opts the board in: the switch it is gated on, beside the
 * empty disable list every test here wants.
 */
const OPTED_IN = { [ENV_DISABLED_EXTENSIONS]: "", [ENV_ENABLED_EXTENSIONS]: "board" };

describe("the board extension", () => {
	test("registers nothing until the session opts in", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "", [ENV_ENABLED_EXTENSIONS]: "" }, () => {
			const fake = createFakePi();
			board(fake.pi, { session: stubSession(), page: stubPage([]) });
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
			expect(fake.handlers.size).toBe(0);
		});
	});

	test("registers one tool and one command, and starts nothing", async () => {
		await withEnv(OPTED_IN, () => {
			const fake = createFakePi();
			const calls: string[] = [];
			board(fake.pi, { session: stubSession(), page: stubPage(calls) });
			expect([...fake.tools.keys()]).toEqual(["board"]);
			expect([...fake.commands.keys()]).toEqual(["board"]);
			expect(calls).toEqual([]);
		});
	});

	test("closes the page on session shutdown", async () => {
		await withEnv(OPTED_IN, async () => {
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
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "board", [ENV_ENABLED_EXTENSIONS]: "board" }, () => {
			const fake = createFakePi();
			board(fake.pi, { session: stubSession(), page: stubPage([]) });
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
		});
	});
});
