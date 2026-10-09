import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	loadRegistries,
	mergeRecords,
	parseRegistry,
	planReconcile,
	projectKey,
	registryDirFor,
	removeLegacyRegistry,
	removeRegistry,
	saveRegistry,
	settleGone,
} from "./registry.ts";
import { REGISTRY_VERSION } from "./registry.ts";
import type { JobRecord } from "./types.ts";
import { withAgentDir } from "../../test/helpers/env.ts";

const record = (overrides: Partial<JobRecord> = {}): JobRecord => ({
	id: "j1",
	label: "build",
	command: "npm run build",
	cwd: "/repo",
	pid: 42,
	status: "running",
	exitCode: null,
	signal: null,
	startedAt: 100,
	finishedAt: null,
	logPath: "/tmp/j1.log",
	statusPath: null,
	detached: false,
	wake: false,
	sessionId: "s1",
	seen: false,
	lastLine: "",
	startToken: null,
	...overrides,
});

describe("projectKey / registryDirFor", () => {
	test("is stable per directory and differs across directories", () => {
		expect(projectKey("/a/repo")).toBe(projectKey("/a/repo"));
		expect(projectKey("/a/repo")).not.toBe(projectKey("/b/repo"));
		expect(projectKey("/a/repo")).toContain("repo");
	});

	test("honours an explicit override", () => {
		expect(registryDirFor("/a/repo", "/custom/dir")).toBe(resolve("/custom/dir"));
	});

	test("defaults under the agent dir so PI_CODING_AGENT_DIR isolates it", async () => {
		await withAgentDir((dir) => {
			expect(registryDirFor("/a/repo")).toBe(join(dir, "jobs", projectKey("/a/repo")));
		});
	});
});

describe("parseRegistry", () => {
	test("yields an empty registry for non-objects", () => {
		expect(parseRegistry(null)).toEqual({
			version: REGISTRY_VERSION,
			sessionId: "unknown",
			counter: 1,
			jobs: [],
		});
		expect(parseRegistry([]).jobs).toEqual([]);
	});

	test("skips malformed job entries and normalizes optional fields", () => {
		const parsed = parseRegistry({
			sessionId: "s1",
			counter: 5,
			jobs: [record(), { id: "bad" }, 7, { ...record({ id: "j2" }), statusPath: undefined, startToken: undefined }],
		});
		expect(parsed.counter).toBe(5);
		expect(parsed.sessionId).toBe("s1");
		expect(parsed.jobs).toHaveLength(2);
		expect(parsed.jobs[1].statusPath).toBeNull();
		expect(parsed.jobs[1].startToken).toBeNull();
	});

	test("falls back to counter 1 for a bad counter", () => {
		expect(parseRegistry({ counter: -3, jobs: [] }).counter).toBe(1);
	});

	test("uses the fallback session when the file has none", () => {
		expect(parseRegistry({ counter: 1, jobs: [] }, "legacy").sessionId).toBe("legacy");
	});
});

describe("saveRegistry / loadRegistries", () => {
	test("round-trips one session's file", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-reg-"));
		try {
			saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "s1", counter: 3, jobs: [record()] });
			const { files, counter } = loadRegistries(dir);
			expect(files).toHaveLength(1);
			expect(files[0].sessionId).toBe("s1");
			expect(files[0].jobs).toHaveLength(1);
			expect(counter).toBe(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("merges files from multiple sessions without clobbering", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-reg-"));
		try {
			saveRegistry(dir, {
				version: REGISTRY_VERSION,
				sessionId: "a",
				counter: 2,
				jobs: [record({ id: "j1", sessionId: "a" })],
			});
			saveRegistry(dir, {
				version: REGISTRY_VERSION,
				sessionId: "b",
				counter: 7,
				jobs: [record({ id: "j2", sessionId: "b" })],
			});
			const { files, counter } = loadRegistries(dir);
			expect(files.map((file) => file.sessionId).sort()).toEqual(["a", "b"]);
			expect(counter).toBe(7);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("reads and removes a legacy shared registry", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-reg-"));
		try {
			writeFileSync(
				join(dir, "registry.json"),
				JSON.stringify({ version: REGISTRY_VERSION, counter: 4, jobs: [record()] }),
				"utf-8",
			);
			const { files, counter } = loadRegistries(dir);
			expect(files[0].sessionId).toBe("legacy");
			expect(counter).toBe(4);
			removeLegacyRegistry(dir);
			expect(loadRegistries(dir).files).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("removeRegistry deletes only the named session's file", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-reg-"));
		try {
			saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "a", counter: 1, jobs: [] });
			saveRegistry(dir, { version: REGISTRY_VERSION, sessionId: "b", counter: 1, jobs: [] });
			removeRegistry(dir, "a");
			expect(loadRegistries(dir).files.map((file) => file.sessionId)).toEqual(["b"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("mergeRecords", () => {
	test("a settled record beats a running one", () => {
		const running = record({ status: "running" });
		const settled = record({ status: "exited", exitCode: 0, finishedAt: 200 });
		expect(mergeRecords(running, settled).status).toBe("exited");
		expect(mergeRecords(settled, running).status).toBe("exited");
	});

	test("the preferred session wins a same-class tie", () => {
		const a = record({ sessionId: "a", startedAt: 100 });
		const b = record({ sessionId: "b", startedAt: 999 });
		expect(mergeRecords(a, b, "a").sessionId).toBe("a");
	});
});

describe("settleGone", () => {
	const options = { isAlive: () => false, tokenMatches: () => true, now: 999 };

	test("leaves a live process running", () => {
		const settled = settleGone(record(), { ...options, isAlive: () => true });
		expect(settled.status).toBe("running");
		expect(settled.finishedAt).toBeNull();
	});

	test("marks a gone process unknown without an exit code", () => {
		const settled = settleGone(record(), options);
		expect(settled.status).toBe("unknown");
		expect(settled.finishedAt).toBe(999);
	});

	test("recovers a zero code as exited and a non-zero as failed", () => {
		expect(settleGone(record(), { ...options, readExitCode: () => 0 })).toMatchObject({
			status: "exited",
			exitCode: 0,
		});
		expect(settleGone(record(), { ...options, readExitCode: () => 3 })).toMatchObject({
			status: "failed",
			exitCode: 3,
		});
	});

	test("a mismatched start token stays unknown and is never signalled", () => {
		const settled = settleGone(record(), { ...options, isAlive: () => true, tokenMatches: () => false });
		expect(settled.status).toBe("unknown");
	});

	test("leaves a finished record untouched", () => {
		const finished = record({ status: "exited", exitCode: 0, finishedAt: 50 });
		expect(settleGone(finished, options)).toBe(finished);
	});
});

describe("planReconcile", () => {
	test("marks a running job with a dead pid as unknown", () => {
		const { jobs, orphans } = planReconcile([record()], () => false, 999);
		expect(jobs[0].status).toBe("unknown");
		expect(jobs[0].finishedAt).toBe(999);
		expect(orphans).toHaveLength(0);
	});

	test("reaps a live, non-detached leftover", () => {
		const { jobs, orphans } = planReconcile([record()], () => true, 999);
		expect(orphans.map((j) => j.id)).toEqual(["j1"]);
		expect(jobs[0].status).toBe("running");
	});

	test("reattaches a live detached job", () => {
		const { orphans } = planReconcile([record({ detached: true })], () => true, 999);
		expect(orphans).toHaveLength(0);
	});

	test("leaves finished jobs untouched", () => {
		const finished = record({ status: "exited", exitCode: 0, finishedAt: 50 });
		const { jobs } = planReconcile([finished], () => true, 999);
		expect(jobs[0]).toEqual(finished);
	});

	test("keeps a live non-detached job owned by another live session", () => {
		const { jobs, orphans } = planReconcile([record({ sessionId: "peer" })], () => true, 999, {
			isOwnerAlive: (id) => id === "peer",
			currentSessionId: "me",
		});
		expect(orphans).toHaveLength(0);
		expect(jobs[0].status).toBe("running");
	});

	test("reaps a live non-detached job whose owner is dead", () => {
		const { orphans } = planReconcile([record({ sessionId: "peer" })], () => true, 999, {
			isOwnerAlive: () => false,
			currentSessionId: "me",
		});
		expect(orphans.map((j) => j.id)).toEqual(["j1"]);
	});

	test("reaps a live non-detached leftover from the current session", () => {
		const { orphans } = planReconcile([record({ sessionId: "me" })], () => true, 999, {
			isOwnerAlive: () => true,
			currentSessionId: "me",
		});
		expect(orphans.map((j) => j.id)).toEqual(["j1"]);
	});
});
