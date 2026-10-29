/**
 * The factory: what it registers, and that registering opens nothing.
 *
 * The server, git, and the web kit are the page's, so the factory must load none
 * of them; the graph guard in `test/dependencies.test.ts` holds that line.
 */

import { describe, expect, test } from "bun:test";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { withEnv } from "../../test/helpers/env.ts";
import { createFakePi } from "../../test/helpers/fakes.ts";
import fileBrowser from "./index.ts";

describe("the file-browse extension", () => {
	test("registers /browse and a session start without opening a page", () => {
		const fake = createFakePi();
		fileBrowser(fake.pi);
		expect([...fake.commands.keys()]).toEqual(["browse"]);
		expect(fake.handlers.get("session_start")).toHaveLength(1);
	});

	test("registers nothing when the extension is disabled", () => {
		const fake = createFakePi();
		withEnv({ [ENV_DISABLED_EXTENSIONS]: "file-browse" }, () => fileBrowser(fake.pi));
		expect([...fake.commands.keys()]).toEqual([]);
	});
});
