import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadRegistry, REGISTRY_VERSION, saveRegistry } from "../../extensions/jobs/registry.ts";
import { createJobStore } from "../../extensions/jobs/store.ts";
import type { Job, JobRecord } from "../../extensions/jobs/types.ts";

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
		detached: false,
		wake: false,
		sessionId: "s1",
		seen: false,
		lastLine: "",
		...overrides,
	};
}

const job = (overrides: Partial<JobRecord> = {}): Job => ({ ...record(overrides), owned: true });

describe("job store", () => {
	test("nextId folds in the on-disk counter and ids", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-store-"));
		try {
			const store = createJobStore(dir);
			saveRegistry(dir, { version: REGISTRY_VERSION, counter: 5, jobs: [record({ id: "j7" })] });
			expect(store.nextId(["j2"])).toBe("j8");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("persist preserves peers and keeps this session's deletions deleted", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-store-"));
		try {
			const store = createJobStore(dir);
			saveRegistry(dir, {
				version: REGISTRY_VERSION,
				counter: 3,
				jobs: [record({ id: "j1" }), record({ id: "j2" }), record({ id: "peer" })],
			});
			store.markRemoved("j2");
			store.persist([job({ id: "j1", seen: true })]);
			const file = loadRegistry(dir);
			expect(file.jobs.map((entry) => entry.id).sort()).toEqual(["j1", "peer"]);
			expect(file.jobs.find((entry) => entry.id === "j1")?.seen).toBe(true);
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
});
