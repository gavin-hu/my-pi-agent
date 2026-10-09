import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRegistries, REGISTRY_VERSION, saveRegistry } from "./registry.ts";
import { createJobStore } from "./store.ts";
import type { Job, JobRecord } from "./types.ts";

function record(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id: "j1",
		label: "build",
		command: "npm run build",
		cwd: "/repo",
		pid: 1,
		status: "running",
		exitCode: null,
		signal: null,
		startedAt: 0,
		finishedAt: null,
		logPath: "/repo/j1.log",
		statusPath: null,
		detached: false,
		wake: false,
		sessionId: "s1",
		seen: false,
		lastLine: "",
		startToken: null,
		...overrides,
	};
}

const job = (overrides: Partial<JobRecord> = {}): Job => ({ ...record(overrides), owned: true });

describe("job store", () => {
	test("persist writes only this session's records", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-store-"));
		try {
			const store = createJobStore(dir);
			store.setSession("me");
			saveRegistry(dir, {
				version: REGISTRY_VERSION,
				sessionId: "peer",
				counter: 3,
				jobs: [record({ id: "j9", sessionId: "peer" })],
			});
			store.persist([job({ id: "j1", sessionId: "me", seen: true }), job({ id: "j2", sessionId: "peer" })]);
			const files = Object.fromEntries(loadRegistries(dir).files.map((file) => [file.sessionId, file]));
			expect(files.me.jobs.map((entry) => entry.id)).toEqual(["j1"]);
			expect(files.me.jobs[0].seen).toBe(true);
			expect(files.peer.jobs.map((entry) => entry.id)).toEqual(["j9"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("safeLogPath accepts only this job's file in the directory", () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeLogPath(record({ id: "j1", logPath: "/tmp/pi-jobs-store/j1.log" }))).toBe(
			resolve(join("/tmp/pi-jobs-store", "j1.log")),
		);
		expect(store.safeLogPath(record({ id: "j1", logPath: "/tmp/elsewhere/j1.log" }))).toBeUndefined();
	});

	test("safeStatusPath accepts only a status file in the directory", () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeStatusPath(record({ id: "j1", statusPath: "/tmp/pi-jobs-store/j1.status" }))).toBe(
			resolve(join("/tmp/pi-jobs-store", "j1.status")),
		);
		expect(store.safeStatusPath(record({ id: "j1", statusPath: "/tmp/elsewhere/j1.status" }))).toBeUndefined();
		expect(store.safeStatusPath(record({ id: "j1", statusPath: null }))).toBeUndefined();
	});
});
