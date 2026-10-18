/**
 * The notify seam the doctor runtime hands to `lib/requirements.ts`.
 *
 * The capability's own loader is exercised in `notify/config.test.ts`; this
 * covers only the wiring, so a seam that reported a stale or made-up method
 * would fail here rather than silently telling doctor everything is fine.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { SHARED_CONFIG_FILE } from "../../../lib/config.ts";
import { tempDir, withAgentDir } from "../../../test/helpers/env.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { notifySeam } from "./runtime.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A session cwd whose project document holds `notify`. */
function projectWith(contents: Record<string, unknown>): string {
	const cwd = temps.track(tempDir("bytefly-doctor-cwd-"));
	mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
	writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), JSON.stringify(contents));
	return cwd;
}

describe("notifySeam", () => {
	test("reports the project document's method over the global one", async () => {
		await withAgentDir((agentDir) => {
			writeFileSync(join(agentDir, SHARED_CONFIG_FILE), JSON.stringify({ notify: { method: "auto" } }));
			const cwd = projectWith({ notify: { enabled: true, method: "toast" } });

			expect(notifySeam(cwd)()).toEqual({ enabled: true, method: "toast" });
		});
	});

	test("reports the defaults when nothing is configured", async () => {
		await withAgentDir(() => {
			const cwd = temps.track(tempDir("bytefly-doctor-cwd-"));

			expect(notifySeam(cwd)()).toEqual({ enabled: false, method: "auto" });
		});
	});

	test("ignores a malformed document instead of throwing", async () => {
		await withAgentDir(() => {
			const cwd = temps.track(tempDir("bytefly-doctor-cwd-"));
			mkdirSync(join(cwd, CONFIG_DIR_NAME), { recursive: true });
			writeFileSync(join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE), "{ not json");

			expect(notifySeam(cwd)()).toEqual({ enabled: false, method: "auto" });
		});
	});
});
