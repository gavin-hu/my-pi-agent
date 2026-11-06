/**
 * The factory: what it registers, what it refuses to register, and what a shutdown
 * closes.
 *
 * The two properties that matter are that it registers without a session (a tool and
 * a command, no listener, no socket), and that `PI_DISABLED_EXTENSIONS` still stops it.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
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
});
