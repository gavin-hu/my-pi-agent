/**
 * A session's jobs are its own: liveness markers, adoption of a dead peer's records, and
 * what a live peer's rows may be touched by.
 *
 * A job is a process, so its record must outlive the session that started it; a peer's
 * records are read to keep ids unique and to keep its work running, and only a session
 * whose process is gone may be taken over. The rule that decides which of those it is
 * lives in `lib/session-roster.ts` and is asked here, so the marker, the adoption, and the
 * reaping these cases pin cannot drift apart.
 *
 * The harness is the shared one — fake spawn, fake liveness, temp registry — so a case
 * reads as the two sessions it describes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistries } from "./registry.ts";
import {
	listSessionMarkers,
	pruneSessionMarkers,
	readSessionMarker,
	removeSessionMarker,
	sessionMarkerPath,
	sessionStateOf,
	touchSessionMarker,
} from "./session.ts";
import { jobRecord, makeCtx, makeHarnessSuite, persistedIds, save } from "../../test/helpers/fixtures/job.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { settle } from "../../test/helpers/process.ts";

const suite = makeHarnessSuite();
const temps = makeTempTracker();

afterEach(() => {
	suite.cleanup();
	temps.flush();
});

describe("job session markers", () => {
	test("sessionMarkerPath is stable per session and differs across sessions", async () => {
		expect(sessionMarkerPath("/dir", "s1")).toBe(sessionMarkerPath("/dir", "s1"));
		expect(sessionMarkerPath("/dir", "s1")).not.toBe(sessionMarkerPath("/dir", "s2"));
	});

	test("sessionMarkerPath hashes the id so it cannot escape the directory", async () => {
		const path = sessionMarkerPath("/dir", "../../evil");
		expect(path.startsWith(join("/dir", "session-"))).toBe(true);
		expect(path).not.toContain("..");
	});

	test("touch/read/remove round-trips through disk", async () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		touchSessionMarker(dir, "s1", 1234, 500);
		expect(readSessionMarker(dir, "s1")).toEqual({ sessionId: "s1", pid: 1234, updatedAt: 500 });
		removeSessionMarker(dir, "s1");
		expect(readSessionMarker(dir, "s1")).toBeUndefined();
		expect(() => removeSessionMarker(dir, "s1")).not.toThrow();
	});

	test("a missing marker is undefined", async () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		expect(readSessionMarker(dir, "s1")).toBeUndefined();
	});

	test("a malformed marker is undefined", async () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		writeFileSync(sessionMarkerPath(dir, "s1"), JSON.stringify({ sessionId: "s1", pid: "x" }), "utf-8");
		expect(readSessionMarker(dir, "s1")).toBeUndefined();
	});

	test("a missing marker is gone", async () => {
		expect(sessionStateOf(undefined, 1000, 100, { alive: () => true })).toBe("gone");
	});

	test("a dead pid is gone even when the heartbeat is fresh", async () => {
		expect(sessionStateOf({ sessionId: "s1", pid: 42, updatedAt: 1000 }, 1000, 100, { alive: () => false })).toBe(
			"gone",
		);
	});

	test("an aged heartbeat with a live pid is quiet, not dead", async () => {
		// The heartbeat stops while a session has nothing running, so this is what a session
		// that has finished its jobs looks like — and it is still that session's work.
		expect(sessionStateOf({ sessionId: "s1", pid: 42, updatedAt: 800 }, 1000, 100, { alive: () => true })).toBe(
			"quiet",
		);
	});

	test("a fresh heartbeat with a live pid is live", async () => {
		expect(sessionStateOf({ sessionId: "s1", pid: 42, updatedAt: 950 }, 1000, 100, { alive: () => true })).toBe("live");
	});

	test("an aged heartbeat whose pid was reused is gone", async () => {
		// Alive, but not the process the marker was written for: the session that wrote it is
		// over, and nothing but the start token can tell the two apart.
		const seams = { alive: () => true, token: () => "someone else" };
		expect(
			sessionStateOf({ sessionId: "s1", pid: 42, startToken: "the session", updatedAt: 800 }, 1000, 100, seams),
		).toBe("gone");
	});

	test("an aged heartbeat whose pid is still the same process stays quiet", async () => {
		const seams = { alive: () => true, token: () => "the session" };
		expect(
			sessionStateOf({ sessionId: "s1", pid: 42, startToken: "the session", updatedAt: 800 }, 1000, 100, seams),
		).toBe("quiet");
	});

	test("a marker naming no usable pid is judged by its heartbeat", async () => {
		expect(sessionStateOf({ sessionId: "s1", pid: 0, updatedAt: 950 }, 1000, 100, { alive: () => false })).toBe("live");
	});

	test("listSessionMarkers lists every valid marker", async () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		touchSessionMarker(dir, "s1", 1, 100);
		touchSessionMarker(dir, "s2", 2, 100);
		expect(
			listSessionMarkers(dir)
				.map((marker) => marker.sessionId)
				.sort(),
		).toEqual(["s1", "s2"]);
	});

	test("pruneSessionMarkers keeps an idle session's marker and drops a gone one", async () => {
		const dir = temps.track(tempDir("pi-jobs-session-"));
		touchSessionMarker(dir, "live", 10, 1000);
		touchSessionMarker(dir, "deadpid", 20, 1000);
		// Older than the TTL with a live pid: a session that has finished its jobs.
		touchSessionMarker(dir, "quiet", 30, 100);
		pruneSessionMarkers(dir, 1000, 100, { alive: (pid) => pid !== 20 });
		expect(
			listSessionMarkers(dir)
				.map((marker) => marker.sessionId)
				.sort(),
		).toEqual(["live", "quiet"]);
	});
});

describe("job runtime — registry reconcile", () => {
	test("recovers an exit code from the status file", async () => {
		const h = suite.makeHarness();
		h.dead.add(888);
		save(h, "old", [jobRecord({ pid: 888, statusPath: join(h.dir, "j1.status") })], 2);
		writeFileSync(join(h.dir, "j1.status"), "0", "utf-8");
		await h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("exited");
		expect(h.runtime.get("j1")?.exitCode).toBe(0);
	});

	test("recovers a non-zero exit code as failed", async () => {
		const h = suite.makeHarness();
		h.dead.add(888);
		save(h, "old", [jobRecord({ pid: 888, statusPath: join(h.dir, "j1.status") })], 2);
		writeFileSync(join(h.dir, "j1.status"), "3", "utf-8");
		await h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("failed");
		expect(h.runtime.get("j1")?.exitCode).toBe(3);
	});

	test("refuses to signal a pid whose start token changed", async () => {
		const h = suite.makeHarness({ startToken: () => "new" });
		save(h, "old", [jobRecord({ startToken: "old" })], 2);
		await h.runtime.load(makeCtx().ctx);
		expect(h.kills).toHaveLength(0);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
	});

	test("adopts a dead session's records and deletes its file", async () => {
		const h = suite.makeHarness();
		save(h, "old", [jobRecord({ detached: true, status: "exited", exitCode: 0, finishedAt: 5, sessionId: "old" })], 2);
		await h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(h.runtime.get("j1")?.sessionId).toBe("me");
		expect(h.runtime.get("j1")?.status).toBe("exited");
		const files = loadRegistries(h.dir).files.map((file) => file.sessionId);
		expect(files).not.toContain("old");
		expect(persistedIds(h)).toContain("j1");
	});

	test("polls a reattached detached job when its pid disappears", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		save(h, "old", [jobRecord({ label: "server", command: "dev", detached: true })], 2);
		await h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");
		h.dead.add(777);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
	});

	test("wakes for a reattached wake job that finishes", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const fired: string[] = [];
		h.runtime.onFinish = (entry) => fired.push(entry.id);
		save(h, "old", [jobRecord({ label: "server", command: "dev", detached: true, wake: true })], 2);
		await h.runtime.load(makeCtx().ctx);
		expect(h.runtime.get("j1")?.status).toBe("running");
		h.dead.add(777);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("unknown");
		expect(fired).toEqual(["j1"]);
	});

	test("reports a reattached job observed gone", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const seen: string[] = [];
		h.runtime.onComplete = (entry) => seen.push(`${entry.id}:${entry.status}`);
		save(h, "old", [jobRecord({ label: "server", command: "dev", detached: true })], 2);
		await h.runtime.load(makeCtx().ctx);
		h.dead.add(777);
		await settle(60);
		expect(seen).toEqual(["j1:unknown"]);
	});

	test("does not report a reattached job with no pid to judge", async () => {
		const h = suite.makeHarness({ config: { repaintMs: 10 } });
		const seen: string[] = [];
		h.runtime.onComplete = (entry) => seen.push(entry.id);
		save(h, "old", [jobRecord({ label: "server", command: "dev", detached: true, pid: null })], 2);
		await h.runtime.load(makeCtx().ctx);
		await settle(60);
		expect(h.runtime.get("j1")?.status).toBe("running");
		expect(seen).toEqual([]);
	});
});

describe("a peer's jobs stay its own", () => {
	test("shows a live peer's jobs and keeps their ids reserved", async () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [jobRecord({ id: "j9", label: "peer", sessionId: "peer", detached: true })], 10);
		const { ctx } = makeCtx({ sessionId: "me" });
		await h.runtime.load(ctx);
		// Visible, but owned by the peer: the row is tagged and the record cannot be
		// cleared here, while its id stays reserved.
		expect(h.runtime.list().map((entry) => entry.id)).toContain("j9");
		expect(h.runtime.list().find((entry) => entry.id === "j9")?.sessionId).toBe("peer");
		expect(h.runtime.sessionId).toBe("me");
		expect(h.runtime.get("j9")?.status).toBe("running");
		expect((await h.runtime.start({ command: "mine" }, ctx)).id).toBe("j10");
	});

	test("clear refuses another session's finished job", async () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(
			h,
			"peer",
			[
				jobRecord({
					id: "j9",
					label: "peer",
					sessionId: "peer",
					detached: true,
					status: "exited",
					exitCode: 0,
					pid: null,
					finishedAt: 5,
				}),
			],
			10,
		);
		await h.runtime.load(makeCtx({ sessionId: "me" }).ctx);
		expect(h.runtime.clear("j9", false).refused).toContain("another live session");
	});

	test("does not count a live peer's running job in the chip", async () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [jobRecord({ id: "j9", label: "peer", sessionId: "peer", detached: true })], 10);
		const { ctx, statuses } = makeCtx({ sessionId: "me" });
		await h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs")).toBe(false);
	});

	test("ignores a live peer's unreported failure in the chip", async () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(
			h,
			"peer",
			[jobRecord({ label: "peer", sessionId: "peer", status: "failed", exitCode: 1, pid: null, finishedAt: 5 })],
			2,
		);
		const { ctx, statuses } = makeCtx({ sessionId: "me" });
		await h.runtime.load(ctx);
		h.runtime.setStatus(ctx);
		expect(statuses.has("jobs-failure")).toBe(false);
	});

	test("shutdown leaves a live peer's job running", async () => {
		const h = suite.makeHarness();
		touchSessionMarker(h.dir, "peer", 999, 1_000_000);
		save(h, "peer", [jobRecord({ label: "peer", sessionId: "peer", detached: false })], 2);
		const { ctx } = makeCtx({ sessionId: "me" });
		await h.runtime.load(ctx);
		await h.runtime.shutdown();
		expect(h.kills.some((kill) => kill.pid === 777)).toBe(false);
	});

	test("persist keeps a peer session's file intact", async () => {
		const h = suite.makeHarness();
		const { ctx } = makeCtx({ sessionId: "me" });
		await h.runtime.load(ctx);
		save(h, "peer", [jobRecord({ id: "j9", label: "peer", sessionId: "peer", detached: true })], 10);
		const entry = await h.runtime.start({ command: "mine" }, ctx);
		expect(entry.id).toBe("j10");
		expect(persistedIds(h)).toContain("j9");
		expect(persistedIds(h)).toContain("j10");
		expect(loadRegistries(h.dir).files.some((file) => file.sessionId === "peer")).toBe(true);
	});
});

describe("a peer's quiet session", () => {
	/**
	 * A peer that has finished its work: its process is alive, but nothing has written its
	 * heartbeat since the last job ended, so the marker is older than the TTL.
	 */
	function quietPeer(h: { dir: string }, id: string, pid: number): void {
		touchSessionMarker(h.dir, id, pid, 0);
	}

	test("keeps its file, its records, its marker, and its log when another session loads", async () => {
		// The heartbeat only ticks while a job runs, so an idle session looks dead within a
		// minute of finishing one: this is the state that used to be adopted and swept.
		const h = suite.makeHarness({ config: { sessionTtlMs: 1 } });
		quietPeer(h, "A", 4242);
		save(h, "A", [jobRecord({ id: "j1", sessionId: "A", status: "exited", exitCode: 0, pid: null, finishedAt: 5 })], 2);
		const logPath = join(h.dir, "j1.log");
		writeFileSync(logPath, "compiled\n", "utf-8");
		const { ctx } = makeCtx({ sessionId: "B" });
		await h.runtime.load(ctx);
		// A's file is still A's, and j1 is still A's record: not adopted, not reported, and not
		// A's to lose when B clears what it has finished.
		expect(loadRegistries(h.dir).files.map((file) => file.sessionId)).toContain("A");
		expect(h.runtime.get("j1")?.sessionId).toBe("A");
		expect(h.runtime.pendingCompletions()).toEqual([]);
		expect(h.runtime.clear("j1", false).refused).toContain("another live session");
		expect(readSessionMarker(h.dir, "A")?.pid).toBe(4242);
		expect(readFileSync(logPath, "utf-8")).toBe("compiled\n");
	});
});

describe("adoption still happens when the owner is gone", () => {
	test("takes over a quiet session's records once its pid was reused", async () => {
		// The one thing age plus a live pid cannot settle: the process is not the one the
		// marker named, so the session that wrote the file is over.
		const h = suite.makeHarness({ config: { sessionTtlMs: 1 }, startToken: () => "someone else" });
		touchSessionMarker(h.dir, "A", 4242, 0, "the session");
		save(h, "A", [jobRecord({ id: "j1", sessionId: "A", status: "exited", exitCode: 0, pid: null, finishedAt: 5 })], 2);
		await h.runtime.load(makeCtx({ sessionId: "B" }).ctx);
		expect(h.runtime.get("j1")?.sessionId).toBe("B");
		expect(loadRegistries(h.dir).files.map((file) => file.sessionId)).not.toContain("A");
	});

	test("leaves a quiet peer's running job alone", async () => {
		const h = suite.makeHarness({ config: { sessionTtlMs: 1 } });
		touchSessionMarker(h.dir, "A", 4242, 0);
		save(h, "A", [jobRecord({ id: "j1", sessionId: "A", detached: false })], 2);
		await h.runtime.load(makeCtx({ sessionId: "B" }).ctx);
		// The job's own pid is alive, and its session is alive: nothing here is B's to reap.
		expect(h.runtime.get("j1")?.status).toBe("running");
		expect(h.kills).toEqual([]);
	});
});
