/**
 * The process seam, and what a pid question answers before it has loaded.
 *
 * The seam arrives with `load`, because asking whether a recorded pid is alive is
 * the first thing a session does; a question asked earlier must answer as it always
 * did rather than throw.
 */

import { describe, expect, test } from "bun:test";
import { LineSplitter } from "../../lib/lines.ts";
import { jobRecord } from "../../test/helpers/fixtures/job.ts";
import { createJobChildren } from "./child.ts";
import { DEFAULT_CONFIG } from "./config.ts";

/** The child module with no process seam yet, as it is before `load`. */
function unloaded() {
	return createJobChildren({
		seams: () => undefined,
		store: () => {
			throw new Error("a pid question does not read the store");
		},
		config: () => DEFAULT_CONFIG,
		now: () => 0,
		newSplitter: () => new LineSplitter(),
		table: {
			record: () => undefined,
			ids: () => [],
			insert: () => {},
			settle: () => {},
			sessionId: () => "s1",
			changed: () => {},
		},
		onSettled: () => {},
		onPaint: () => {},
	});
}

describe("the process seam before it loads", () => {
	test("a pid question answers as it always did, without throwing", () => {
		const children = unloaded();
		expect(children.alive(4242)).toBe(true);
		expect(children.owns(jobRecord({ startToken: "old" }))).toBe(true);
		expect(children.startToken(4242)).toBeUndefined();
	});
});
