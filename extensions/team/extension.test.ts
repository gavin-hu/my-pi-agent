/**
 * The factory: one tool, one command, no listener, and silence when the package
 * disables it.
 *
 * `team` is the extension that carries the bus dependency, so the property worth
 * pinning is that it registers without a bus being present — the dependency is a
 * nested tool call that fails with a message, never a start-up requirement.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import { stubSession } from "../../test/helpers/board.ts";
import { writeJoinedRecord } from "../../test/helpers/bus.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir, withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import team from "./index.ts";

/**
 * The environment every test here wants: the empty disable list, so the factory
 * registers.
 */
const ENABLED = { [ENV_DISABLED_EXTENSIONS]: "" };

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("the team extension", () => {
	test("registers one tool and one command, and opens nothing", async () => {
		await withEnv(ENABLED, () => {
			const fake = createFakePi();
			team(fake.pi, { session: stubSession() });
			expect([...fake.tools.keys()]).toEqual(["team"]);
			// `/team` prints the round; the store and the bus are read when it runs, not now.
			expect([...fake.commands.keys()]).toEqual(["team"]);
		});
	});

	test("registers nothing when the package disabled it", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "team" }, () => {
			const fake = createFakePi();
			team(fake.pi, { session: stubSession() });
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
		});
	});

	/**
	 * The tool a session is offered: the team's own question, asked where a turn starts.
	 *
	 * `board` proves the machinery; these cases are the one difference — `solo: false`, so a run with
	 * no bus offers nothing, because there is nothing to hand over.
	 */
	describe("the tool a session is offered", () => {
		const NOW = 50_000;

		/** A session whose bus directory is a temp dir a case can put a record in. */
		function onBus(): { session: BoardSession; dir: string } {
			const dir = temps.track(tempDir("pi-team-gate-"));
			return {
				session: {
					...stubSession(),
					now: () => NOW,
					busDir: async () => dir,
					roster: async () => {
						const { readRoster } = await import("../../lib/session-roster.ts");
						return readRoster(dir);
					},
				},
				dir,
			};
		}

		/** One turn start, as the host runs it: every handler, in order. */
		async function turn(fake: ReturnType<typeof createFakePi>, ctx: unknown): Promise<void> {
			for (const handler of fake.handlers.get("before_agent_start") ?? []) await handler({}, ctx);
		}

		/** A team entry whose bus is loaded: the `session` tool is how `busLoaded` knows. */
		function busEntry(session: BoardSession) {
			const fake = createFakePi();
			fake.pi.registerTool({ name: "session" });
			team(fake.pi, { session });
			return fake;
		}

		test("is offered only once a turn finds this session on the team", async () => {
			await withEnv(ENABLED, async () => {
				const bus = onBus();
				const { ctx } = fakeCtx({ sessionId: "s-lead" });
				const fake = busEntry(bus.session);
				await turn(fake, ctx);
				expect(fake.pi.getActiveTools()).not.toContain("team");

				await writeJoinedRecord(bus.dir, { id: "s-lead", label: "billing-lead", lastSeen: NOW });
				await turn(fake, ctx);
				expect(fake.pi.getActiveTools()).toContain("team");
			});
		});

		test("is withdrawn the turn after the record goes", async () => {
			await withEnv(ENABLED, async () => {
				const bus = onBus();
				const file = await writeJoinedRecord(bus.dir, { id: "s-lead", label: "billing-lead", lastSeen: NOW });
				const fake = busEntry(bus.session);
				const { ctx } = fakeCtx({ sessionId: "s-lead" });
				await turn(fake, ctx);
				expect(fake.pi.getActiveTools()).toContain("team");
				const { removeBusRecord } = await import("../../test/helpers/bus.ts");
				removeBusRecord(file);
				await turn(fake, ctx);
				expect(fake.pi.getActiveTools()).not.toContain("team");
			});
		});

		test("is never offered with no bus loaded, however long the session runs", async () => {
			await withEnv(ENABLED, async () => {
				const fake = createFakePi();
				team(fake.pi, { session: stubSession() });
				await turn(fake, fakeCtx().ctx);
				await turn(fake, fakeCtx().ctx);
				// `solo: false` is the whole difference from `board`: nothing can be handed over.
				expect(fake.pi.getActiveTools()).not.toContain("team");
			});
		});

		test("is offered on a session that starts in-process with a record already on the bus", async () => {
			await withEnv(ENABLED, async () => {
				const bus = onBus();
				await writeJoinedRecord(bus.dir, { id: "s-lead", label: "billing-lead", lastSeen: NOW });
				const fake = busEntry(bus.session);
				const { ctx } = fakeCtx({ sessionId: "s-lead" });
				for (const handler of fake.handlers.get("session_start") ?? []) await handler({}, ctx);
				expect(fake.pi.getActiveTools()).toContain("team");
			});
		});
	});
});
