/**
 * The factory: one tool, no listener, and silence when the package disables it.
 *
 * `team` is the extension that carries the bus dependency, so the property worth
 * pinning is that it registers without a bus being present — the dependency is a
 * nested tool call that fails with a message, never a start-up requirement.
 */

import { describe, expect, test } from "bun:test";
import type { BoardSession } from "../../lib/board/session.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import { withEnv } from "../../test/helpers/env.ts";
import team from "./index.ts";

/** A session that never touches the disk. */
function stubSession(): BoardSession {
	return {
		store: () => {
			throw new Error("the factory must not open a store");
		},
		who: () => ({ label: "billing-lead" }),
		now: () => 0,
	};
}

describe("the team extension", () => {
	test("registers exactly one tool, and opens nothing", () => {
		const fake = createFakePi();
		team(fake.pi, { session: stubSession() });
		expect([...fake.tools.keys()]).toEqual(["team"]);
		expect(fake.commands.size).toBe(0);
	});

	test("registers nothing when the package disabled it", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "team" }, () => {
			const fake = createFakePi();
			team(fake.pi, { session: stubSession() });
			expect(fake.tools.size).toBe(0);
		});
	});
});
