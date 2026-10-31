import { afterEach, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { loadRegistries, REGISTRY_VERSION, saveRegistry } from "./registry.ts";
import { createJobStore } from "./store.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { jobRecord, job } from "../../test/helpers/fixtures/job.ts";

const temps = makeTempTracker();
afterEach(() => {
	temps.flush();
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
