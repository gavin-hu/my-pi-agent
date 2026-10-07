import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	loadRegistry,
	parseRegistry,
	planReconcile,
	projectKey,
	registryDirFor,
	saveRegistry,
} from "../../extensions/jobs/registry.ts";
import { REGISTRY_VERSION } from "../../extensions/jobs/registry.ts";
import type { JobRecord } from "../../extensions/jobs/types.ts";

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
	detached: false,
	wake: false,
	sessionId: "s1",
	seen: false,
	lastLine: "",
	...overrides,
});

describe("projectKey / registryDirFor", () => {
	test("is stable per directory and differs across directories", () => {
		expect(projectKey("/a/repo")).toBe(projectKey("/a/repo"));
		expect(projectKey("/a/repo")).not.toBe(projectKey("/b/repo"));
		expect(projectKey("/a/repo")).toContain("repo");
	});

	test("honours an explicit override", () => {
		expect(registryDirFor("/a/repo", "/custom/dir")).toBe("/custom/dir");
	});
});

describe("parseRegistry", () => {
	test("yields an empty registry for non-objects", () => {
		expect(parseRegistry(null)).toEqual({ version: REGISTRY_VERSION, counter: 1, jobs: [] });
		expect(parseRegistry([])).toEqual({ version: REGISTRY_VERSION, counter: 1, jobs: [] });
	});

	test("skips malformed job entries", () => {
		const parsed = parseRegistry({ counter: 5, jobs: [record(), { id: "bad" }, 7] });
		expect(parsed.counter).toBe(5);
		expect(parsed.jobs).toHaveLength(1);
	});

	test("falls back to counter 1 for a bad counter", () => {
		expect(parseRegistry({ counter: -3, jobs: [] }).counter).toBe(1);
	});
});

describe("saveRegistry / loadRegistry", () => {
	test("round-trips through disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-reg-"));
		try {
			saveRegistry(dir, { version: REGISTRY_VERSION, counter: 3, jobs: [record()] });
			expect(loadRegistry(dir).jobs).toHaveLength(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("a missing file yields an empty registry", () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-jobs-reg-"));
		try {
			expect(loadRegistry(dir).jobs).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
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
});
