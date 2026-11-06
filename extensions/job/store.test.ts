import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadRegistries, REGISTRY_VERSION, saveRegistry } from "./registry.ts";
import { createJobStore } from "./store.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { job, jobRecord, makeCtx, makeHarnessSuite } from "../../test/helpers/fixtures/job.ts";

const suite = makeHarnessSuite();
const temps = makeTempTracker();
afterEach(() => {
	suite.cleanup();
	temps.flush();
});

describe("job registry directory", () => {
	test("start creates the directory before reserving an id", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		// A first job in a project whose registry directory does not exist yet
		// must still be able to reserve its id (`O_EXCL` lock inside that dir).
		rmSync(h.dir, { recursive: true, force: true });
		const entry = await h.runtime.start({ command: "sleep 10" }, ctx);
		expect(existsSync(h.dir)).toBe(true);
		expect(entry.id).toBe("j1");
	});

	test("start runs a job when the directory cannot be written", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx();
		await h.runtime.load(ctx);
		// A regular file where the registry directory belongs: the mkdir, the id lock and
		// the registry write all fail, and the job must start all the same.
		rmSync(h.dir, { recursive: true, force: true });
		writeFileSync(h.dir, "");
		const entry = await h.runtime.start({ command: "sleep 10" }, ctx);
		expect(entry.id).toBe("j1");
		expect(entry.status).toBe("running");
	});
});

describe("job store", () => {
	test("persist writes only this session's records", async () => {
		const dir = temps.track(tempDir("pi-jobs-store-"));
		const store = createJobStore(dir);
		store.setSession("me");
		saveRegistry(dir, {
			version: REGISTRY_VERSION,
			sessionId: "peer",
			counter: 3,
			jobs: [jobRecord({ id: "j9", sessionId: "peer" })],
		});
		store.persist([job({ id: "j1", sessionId: "me", seen: true }), job({ id: "j2", sessionId: "peer" })]);
		const files = Object.fromEntries(loadRegistries(dir).files.map((file) => [file.sessionId, file]));
		expect(files.me.jobs.map((entry) => entry.id)).toEqual(["j1"]);
		expect(files.me.jobs[0].seen).toBe(true);
		expect(files.peer.jobs.map((entry) => entry.id)).toEqual(["j9"]);
	});

	test("safeLogPath accepts only this job's file in the directory", async () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeLogPath(jobRecord({ id: "j1", logPath: "/tmp/pi-jobs-store/j1.log" }))).toBe(
			resolve(join("/tmp/pi-jobs-store", "j1.log")),
		);
		expect(store.safeLogPath(jobRecord({ id: "j1", logPath: "/tmp/elsewhere/j1.log" }))).toBeUndefined();
	});

	test("safeStatusPath accepts only a status file in the directory", async () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeStatusPath(jobRecord({ id: "j1", statusPath: "/tmp/pi-jobs-store/j1.status" }))).toBe(
			resolve(join("/tmp/pi-jobs-store", "j1.status")),
		);
		expect(store.safeStatusPath(jobRecord({ id: "j1", statusPath: "/tmp/elsewhere/j1.status" }))).toBeUndefined();
		expect(store.safeStatusPath(jobRecord({ id: "j1", statusPath: null }))).toBeUndefined();
	});

	test("safeRotatedLogPath derives the previous segment and refuses a traversing id", async () => {
		const store = createJobStore("/tmp/pi-jobs-store");
		expect(store.safeRotatedLogPath(jobRecord({ id: "j1" }))).toBe(resolve(join("/tmp/pi-jobs-store", "j1.log.1")));
		expect(store.safeRotatedLogPath(jobRecord({ id: "../../escape" }))).toBeUndefined();
	});
});
