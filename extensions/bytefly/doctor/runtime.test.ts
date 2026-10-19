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
import { createDoctorRuntime, notifySeam } from "./runtime.ts";

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

describe("createDoctorRuntime — the published search provider", () => {
	/** A runtime whose probes record the seam values they saw. */
	function runtimeWith(overrides: Record<string, unknown> = {}) {
		const seen: Array<{ refresh: boolean | undefined; facts: unknown }> = [];
		const reached: string[] = [];
		const runtime = createDoctorRuntime({ exec: async () => ({ code: 0 }) } as never, {
			seams: {
				...overrides,
				reach: async (url: string) => {
					reached.push(url);
					return { ok: true };
				},
			},
		});
		return { runtime, seen, reached };
	}

	test("hands the published facts to the probe, and only on a refresh does it reach", async () => {
		const { runtime, reached } = runtimeWith();
		runtime.configure({ cwd: projectWith({}), config: { proactive: false, timeoutMs: 2_000, skip: [] } });

		runtime.noteSearchFacts({
			provider: "searxng",
			reason: "explicit",
			configured: true,
			endpoint: "http://searx.local:8080",
			apiKeyEnv: null,
			keyConfigured: false,
		});

		const cheap = await runtime.probeAll();
		const webAccess = cheap.find((report) => report.extension === "web-access");
		expect(webAccess?.findings.some((finding) => finding.detail.includes("resolved to searxng"))).toBe(true);
		expect(reached).toEqual([]);

		const refreshed = await runtime.probeAll({ refresh: true });
		const after = refreshed.find((report) => report.extension === "web-access");
		expect(after?.findings.some((finding) => finding.check === "http://searx.local:8080")).toBe(true);
		expect(reached).toEqual(["http://searx.local:8080"]);
	});

	test("a reset forgets the published facts", async () => {
		const { runtime } = runtimeWith();
		runtime.configure({ cwd: projectWith({}), config: { proactive: false, timeoutMs: 2_000, skip: [] } });
		runtime.noteSearchFacts({
			provider: "brave",
			reason: "explicit",
			configured: false,
			endpoint: null,
			apiKeyEnv: "BRAVE_SEARCH_API_KEY",
			keyConfigured: false,
		});
		runtime.reset();

		const reports = await runtime.probeAll();
		const webAccess = reports.find((report) => report.extension === "web-access");
		expect(webAccess?.findings.some((finding) => finding.detail.includes("has not reported"))).toBe(true);
	});
});
