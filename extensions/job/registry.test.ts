import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	loadRegistries,
	mergeRecords,
	parseRegistry,
	planReconcile,
	projectKey,
	REGISTRY_VERSION,
	registryDirFor,
	removeLegacyRegistry,
	removeRegistry,
	saveRegistry,
	settleGone,
} from "./registry.ts";
import { tempDir, withAgentDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { jobRecord } from "../../test/helpers/fixtures/job.ts";

const temps = makeTempTracker();
afterEach(() => {
	temps.flush();
});

describe("job registry", () => {
	test("projectKey is stable per directory and differs across directories", async () => {
		expect(projectKey("/a/repo")).toBe(projectKey("/a/repo"));
		expect(projectKey("/a/repo")).not.toBe(projectKey("/b/repo"));
		expect(projectKey("/a/repo")).toContain("repo");
	});

	test("registryDirFor honours an explicit override", async () => {
		expect(registryDirFor("/a/repo", "/custom/dir")).toBe(resolve("/custom/dir"));
	});

	test("registryDirFor defaults under the agent dir so PI_CODING_AGENT_DIR isolates it", async () => {
		await withAgentDir((dir) => {
			expect(registryDirFor("/a/repo")).toBe(join(dir, "jobs", projectKey("/a/repo")));
		});
	});

	test("parseRegistry yields an empty registry for non-objects", async () => {
		expect(parseRegistry(null)).toEqual({
			version: REGISTRY_VERSION,
			sessionId: "unknown",
			counter: 1,
			jobs: [],
		});
		expect(parseRegistry([]).jobs).toEqual([]);
	});

	test("parseRegistry skips malformed job entries and normalizes optional fields", async () => {
		const parsed = parseRegistry({
			sessionId: "s1",
			counter: 5,
			jobs: [
				jobRecord(),
				{ id: "bad" },
				7,
				{ ...jobRecord({ id: "j2" }), statusPath: undefined, startToken: undefined },
			],
		});
		expect(parsed.counter).toBe(5);
		expect(parsed.sessionId).toBe("s1");
		expect(parsed.jobs).toHaveLength(2);
		expect(parsed.jobs[1].statusPath).toBeNull();
		expect(parsed.jobs[1].startToken).toBeNull();
	});

	test("parseRegistry falls back to counter 1 for a bad counter", async () => {
		expect(parseRegistry({ counter: -3, jobs: [] }).counter).toBe(1);
	});

	test("parseRegistry uses the fallback session when the file has none", async () => {
		expect(parseRegistry({ counter: 1, jobs: [] }, "legacy").sessionId).toBe("legacy");
	});

	test("saveRegistry round-trips one session's file", async () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "s1", counter: 3, jobs: [jobRecord()] });
		const { files, counter } = loadRegistries(dir);
		expect(files).toHaveLength(1);
		expect(files[0].sessionId).toBe("s1");
		expect(files[0].jobs).toHaveLength(1);
		expect(counter).toBe(3);
	});

	test("loadRegistries merges files from multiple sessions without clobbering", async () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		saveRegistry(dir, {
			version: REGISTRY_VERSION,
			sessionId: "a",
			counter: 2,
			jobs: [jobRecord({ id: "j1", sessionId: "a" })],
		});
		saveRegistry(dir, {
			version: REGISTRY_VERSION,
			sessionId: "b",
			counter: 7,
			jobs: [jobRecord({ id: "j2", sessionId: "b" })],
		});
		const { files, counter } = loadRegistries(dir);
		expect(files.map((file) => file.sessionId).sort()).toEqual(["a", "b"]);
		expect(counter).toBe(7);
	});

	test("reads and removes a legacy shared registry", async () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		writeFileSync(
			join(dir, "registry.json"),
			JSON.stringify({ version: REGISTRY_VERSION, counter: 4, jobs: [jobRecord()] }),
			"utf-8",
		);
		const { files, counter } = loadRegistries(dir);
		expect(files[0].sessionId).toBe("legacy");
		expect(counter).toBe(4);
		removeLegacyRegistry(dir);
		expect(loadRegistries(dir).files).toEqual([]);
	});

	test("removeRegistry deletes only the named session's file", async () => {
		const dir = temps.track(tempDir("pi-jobs-reg-"));
		saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "a", counter: 1, jobs: [] });
		saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "b", counter: 1, jobs: [] });
		removeRegistry(dir, "a");
		expect(loadRegistries(dir).files.map((file) => file.sessionId)).toEqual(["b"]);
	});

	test("mergeRecords lets a settled record beat a running one", async () => {
		const running = jobRecord({ status: "running" });
		const settled = jobRecord({ status: "exited", exitCode: 0, finishedAt: 200 });
		expect(mergeRecords(running, settled).status).toBe("exited");
		expect(mergeRecords(settled, running).status).toBe("exited");
	});

	test("mergeRecords lets the preferred session win a same-class tie", async () => {
		const a = jobRecord({ sessionId: "a", startedAt: 100 });
		const b = jobRecord({ sessionId: "b", startedAt: 999 });
		expect(mergeRecords(a, b, "a").sessionId).toBe("a");
	});
});

describe("settleGone", () => {
	const options = { isAlive: () => false, tokenMatches: () => true, now: 999 };

	test("leaves a live process running", async () => {
		const settled = settleGone(jobRecord(), { ...options, isAlive: () => true });
		expect(settled.status).toBe("running");
		expect(settled.finishedAt).toBeNull();
	});

	test("marks a gone process unknown without an exit code", async () => {
		const settled = settleGone(jobRecord(), options);
		expect(settled.status).toBe("unknown");
		expect(settled.finishedAt).toBe(999);
	});

	test("recovers a zero code as exited and a non-zero as failed", async () => {
		expect(settleGone(jobRecord(), { ...options, readExitCode: () => 0 })).toMatchObject({
			status: "exited",
			exitCode: 0,
		});
		expect(settleGone(jobRecord(), { ...options, readExitCode: () => 3 })).toMatchObject({
			status: "failed",
			exitCode: 3,
		});
	});

	test("a mismatched start token stays unknown and is never signalled", async () => {
		const settled = settleGone(jobRecord(), { ...options, isAlive: () => true, tokenMatches: () => false });
		expect(settled.status).toBe("unknown");
	});

	test("leaves a finished record untouched", async () => {
		const finished = jobRecord({ status: "exited", exitCode: 0, finishedAt: 50 });
		expect(settleGone(finished, options)).toBe(finished);
	});
});

describe("planReconcile", () => {
	test("marks a running job with a dead pid as unknown", async () => {
		const { jobs, orphans } = planReconcile([jobRecord()], () => false, 999);
		expect(jobs[0].status).toBe("unknown");
		expect(jobs[0].finishedAt).toBe(999);
		expect(orphans).toHaveLength(0);
	});

	test("reaps a live, non-detached leftover", async () => {
		const { jobs, orphans } = planReconcile([jobRecord()], () => true, 999);
		expect(orphans.map((entry) => entry.id)).toEqual(["j1"]);
		expect(jobs[0].status).toBe("running");
	});

	test("reattaches a live detached job", async () => {
		const { orphans } = planReconcile([jobRecord({ detached: true })], () => true, 999);
		expect(orphans).toHaveLength(0);
	});

	test("leaves finished jobs untouched", async () => {
		const finished = jobRecord({ status: "exited", exitCode: 0, finishedAt: 50 });
		const { jobs } = planReconcile([finished], () => true, 999);
		expect(jobs[0]).toEqual(finished);
	});

	test("keeps a live non-detached job owned by another live or quiet session", async () => {
		const { jobs, orphans } = planReconcile([jobRecord({ sessionId: "peer" })], () => true, 999, {
			ownerState: (id) => (id === "peer" ? "quiet" : "gone"),
			currentSessionId: "me",
		});
		expect(orphans).toHaveLength(0);
		expect(jobs[0].status).toBe("running");
	});

	test("reaps a live non-detached job whose owner is dead", async () => {
		const { orphans } = planReconcile([jobRecord({ sessionId: "peer" })], () => true, 999, {
			ownerState: () => "gone",
			currentSessionId: "me",
		});
		expect(orphans.map((entry) => entry.id)).toEqual(["j1"]);
	});

	test("reaps a live non-detached leftover from the current session", async () => {
		const { orphans } = planReconcile([jobRecord({ sessionId: "me" })], () => true, 999, {
			ownerState: () => "live",
			currentSessionId: "me",
		});
		expect(orphans.map((entry) => entry.id)).toEqual(["j1"]);
	});
});
