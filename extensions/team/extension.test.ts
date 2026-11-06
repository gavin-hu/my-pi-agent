/**
 * The factory: one tool, one command, no listener, and silence when the package
 * disables it.
 *
 * `team` is the extension that carries the bus dependency, so the property worth
 * pinning is that it registers without a bus being present — the dependency is a
 * nested tool call that fails with a message, never a start-up requirement.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { stubSession } from "../../test/helpers/board.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import team from "./index.ts";

/**
 * The environment every test here wants: the empty disable list, so the factory
 * registers.
 */
const ENABLED = { [ENV_DISABLED_EXTENSIONS]: "" };

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
});
