/**
 * The factory: one tool, one command, no listener, and silence until the session
 * opts in or when the package disables it.
 *
 * `team` is the extension that carries the bus dependency, so the property worth
 * pinning is that it registers without a bus being present — the dependency is a
 * nested tool call that fails with a message, never a start-up requirement.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS, ENV_ENABLED_EXTENSIONS } from "../../lib/env.ts";
import { stubSession } from "../../test/helpers/board.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import team from "./index.ts";

/**
 * The environment that opts the lead's round in: the switch it is gated on,
 * beside the empty disable list every test here wants.
 */
const OPTED_IN = { [ENV_DISABLED_EXTENSIONS]: "", [ENV_ENABLED_EXTENSIONS]: "board,team" };

describe("the team extension", () => {
	test("registers nothing until the session opts in", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "", [ENV_ENABLED_EXTENSIONS]: "" }, () => {
			const fake = createFakePi();
			team(fake.pi, { session: stubSession() });
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
			expect(fake.handlers.size).toBe(0);
		});
	});

	test("registers one tool and one command, and opens nothing", async () => {
		await withEnv(OPTED_IN, () => {
			const fake = createFakePi();
			team(fake.pi, { session: stubSession() });
			expect([...fake.tools.keys()]).toEqual(["team"]);
			// `/team` prints the round; the store and the bus are read when it runs, not now.
			expect([...fake.commands.keys()]).toEqual(["team"]);
		});
	});

	test("registers nothing when the package disabled it", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "team", [ENV_ENABLED_EXTENSIONS]: "board,team" }, () => {
			const fake = createFakePi();
			team(fake.pi, { session: stubSession() });
			expect(fake.tools.size).toBe(0);
			expect(fake.commands.size).toBe(0);
		});
	});
});
