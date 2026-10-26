/**
 * The factory: what it registers, what it refuses to register, and what a shutdown
 * closes.
 *
 * The extension is one of the package's optional surfaces, so the two properties
 * that matter are that it registers without a session (a tool and a command, no
 * listener, no socket) and that disabling it is silent.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
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
		who: () => ({ label: "billing-lead" }),
		now: () => 0,
		busDir: async () => {
			throw new Error("the factory must not read the bus");
		},
		joined: () => false,
		markJoined: () => {},
	};
}

/** A page that records its lifecycle. */
function stubPage(calls: string[]): BoardPage {
	return {
		start: async () => {
			calls.push("start");
			return { kind: "served", seat: "team-lead", port: 1, url: "http://127.0.0.1:1/", where: "x" };
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

describe("the board extension", () => {
	test("registers one tool and one command, and starts nothing", () => {
		const fake = createFakePi();
		const calls: string[] = [];
		board(fake.pi, { session: stubSession(), page: stubPage(calls) });
		expect([...fake.tools.keys()]).toEqual(["board"]);
		expect([...fake.commands.keys()]).toEqual(["board"]);
		expect(calls).toEqual([]);
	});

	test("closes the page on session shutdown", async () => {
		const fake = createFakePi();
		const calls: string[] = [];
		board(fake.pi, { session: stubSession(), page: stubPage(calls) });
		const handlers = fake.handlers.get("session_shutdown") ?? [];
		const { ctx } = fakeCtx();
		for (const handler of handlers) await handler({}, ctx);
		expect(calls).toEqual(["closeAll"]);
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
