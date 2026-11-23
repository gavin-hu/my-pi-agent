import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
	test("a store with no directory refuses every write, and leaves the process's cwd untouched", async () => {
		// An empty directory is a *relative* path: the reservation's create and its removal, the
		// rotation's paths and the child's status paths would all land beside whatever directory the
		// process is in. The read paths still answer from the table they hold; every path that writes
		// or unlinks needs a place first.
		const cwd = temps.track(tempDir("pi-jobs-cwd-"));
		const previous = process.cwd();
		process.chdir(cwd);
		try {
			const store = createJobStore();
			expect(() => store.nextId([])).toThrow("no directory");
			expect(() => store.logPath("j1")).toThrow("no directory");
			// The four path getters a write goes through: the rotation's rename and the status write.
			expect(() => store.rotatedLogPath("j1")).toThrow("no directory");
			expect(() => store.statusPath("j1")).toThrow("no directory");
			expect(() => store.safeRotatedLogPath(jobRecord({ id: "j1" }))).toThrow("no directory");
			expect(() => store.safeStatusPath(jobRecord({ id: "j1" }))).toThrow("no directory");
			// One of the two that touches the filesystem: the removal, which would unlink `<id>.lock`.
			expect(() => store.releaseId("j1")).toThrow("no directory");
			// `persist` keeps its swallow — a job still works in-process — and writes nothing.
			store.persist([job({ sessionId: "session" })]);
			expect(readdirSync(cwd)).toEqual([]);
		} finally {
			process.chdir(previous);
		}
	});

	test("the reservation sweep is the one accessor that writes, and it refuses beside the process too", async () => {
		// Its own case because it is not a path getter and not an unlink: an unguarded
		// `pruneReservations("")` writes the reservation file into the process's directory.
		const cwd = temps.track(tempDir("pi-jobs-cwd-"));
		const previous = process.cwd();
		process.chdir(cwd);
		try {
			expect(() => createJobStore().pruneReservations(new Set())).toThrow("no directory");
			expect(readdirSync(cwd)).toEqual([]);
		} finally {
			process.chdir(previous);
		}
	});

	test("a placed store answers every one of them exactly as before", async () => {
		// The regression half a guard needs: the cheap way to pass a refusal case is to refuse too
		// much, and every path a placed store answers is what the rotation, the status write and the
		// reservation sweep read on every job.
		const dir = temps.track(tempDir("pi-jobs-store-"));
		const store = createJobStore(dir);
		expect(store.rotatedLogPath("j1")).toBe(join(dir, "j1.log.1"));
		expect(store.statusPath("j1")).toBe(join(dir, "j1.status"));
		expect(store.safeRotatedLogPath(jobRecord({ id: "j1" }))).toBe(join(dir, "j1.log.1"));
		// A record that names no status file still answers nothing — the guard must not invent one.
		expect(store.safeStatusPath(jobRecord({ id: "j1" }))).toBeUndefined();
		expect(store.safeStatusPath(jobRecord({ id: "j1", statusPath: join(dir, "j1.status") }))).toBe(
			join(dir, "j1.status"),
		);
		expect(store.logPath("j1")).toBe(join(dir, "j1.log"));
		expect(() => store.releaseId("j1")).not.toThrow();
		expect(() => store.pruneReservations(new Set())).not.toThrow();
	});

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
