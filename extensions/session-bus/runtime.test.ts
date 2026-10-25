import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { execP, makeRepo, makeTempTracker } from "../../test/helpers/git.ts";
import { canCreateSymlinks } from "../../test/helpers/platform.ts";
import { settle } from "../../test/helpers/process.ts";
import { runSlowSuites } from "../../test/helpers/slow-suite.ts";
import { createSessionBus, type SessionBus, type SessionBusOptions } from "./runtime.ts";
import { createBusStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function busDir(): string {
	return temps.track(tempDir("pi-session-bus-"));
}

function context(cwd: string, sessionId: string, sessionName: string, mode = "tui"): ExtensionContext {
	return fakeCtx({ cwd, sessionId, sessionName, mode, hasUI: mode === "tui" }).ctx as ExtensionContext;
}

function runtime(dir: string, options: Partial<SessionBusOptions> = {}): SessionBus {
	return createSessionBus({} as ExtensionAPI, { dir, now: () => 1_000, heartbeatMs: 0, watchMs: 0, ...options });
}

function bus(dir: string, root: string, now: () => number, watchMs = 0): SessionBus {
	return runtime(dir, { repo: { root, key: "shared" }, now, watchMs });
}

/**
 * Join without listening: one action puts the session on the bus under its own name —
 * yielding a suffix when that name is taken — and leaves the watch off, which is the
 * state a case that only needs an addressable peer wants.
 */
async function acting(session: SessionBus, ctx: ExtensionContext): Promise<void> {
	await session.start(ctx);
	await session.join({ listen: false });
}

describe("registration", () => {
	test("no mode joins on start; a name joins, and a reader stays off the bus", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const terminal = bus(dir, "/repo/frontend", now);
		const terminalCtx = context("/repo/frontend", "s1", "frontend");
		await terminal.start(terminalCtx);
		const worker = bus(dir, "/repo/backend", now);
		const workerCtx = context("/repo/backend", "s2", "backend", "json");
		await worker.start(workerCtx);
		const store = createBusStore({ dir });
		// Neither a terminal nor a headless session is on the bus because it started.
		expect(await store.sessions()).toEqual([]);
		// Reading is not joining either: the board lists a bus this session is not on.
		const read = await terminal.status();
		expect(read.onBus).toBe(false);
		expect(read.sessions).toEqual([]);
		expect(await store.sessions()).toEqual([]);
		// A name joins, in any mode.
		await worker.join({ label: "backend", listen: false });
		expect((await store.sessions()).map((session) => session.label)).toEqual(["backend"]);
		await terminal.stop();
		await worker.stop();
	});

	test("stop removes the record and releases claims", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));
		expect((await first.claim(["src/api"])).claimed).toEqual(["src/api"]);
		await first.stop();
		const store = createBusStore({ dir });
		expect(await store.sessions()).toHaveLength(1);
		expect(await store.claims()).toEqual([]);
		await second.stop();
	});

	test("stopping one process of a resumed session leaves the survivor its claims", async () => {
		const dir = busDir();
		const now = () => 1_000;
		// `/resume` in a second pane registers one session id from two processes.
		const first = runtime(dir, { repo: { root: "/repo/frontend", key: "shared" }, now, pid: 100 });
		const second = runtime(dir, { repo: { root: "/repo/frontend", key: "shared" }, now, pid: 200 });
		const both = context("/repo/frontend", "s1", "frontend");
		await acting(first, both);
		await acting(second, both);
		expect((await second.claim(["src/api"])).claimed).toEqual(["src/api"]);
		await first.stop();
		// The record names the process that owns it, so the older one leaves both alone.
		expect((await second.status()).claims.map((claim) => claim.path)).toEqual(["src/api"]);
		await second.stop();
		const store = createBusStore({ dir });
		expect(await store.sessions()).toEqual([]);
		expect(await store.claims()).toEqual([]);
	});
});

describe("messages", () => {
	test("sends to a label and consumes once", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));

		const sent = await first.send({ to: "backend", text: "contract v2", kind: "message", paths: ["src/api"] });
		expect(sent.delivered).toEqual(["backend"]);
		const messages = await second.inbox();
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({ text: "contract v2", fromLabel: "frontend", paths: ["src/api"] });
		expect(await second.inbox()).toEqual([]);
		await first.stop();
		await second.stop();
	});

	test("broadcasts only an event", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));
		expect(await first.send({ to: "*", text: "build failed", kind: "event" })).toMatchObject({
			delivered: ["backend"],
		});
		await expect(first.send({ to: "*", text: "hello", kind: "message" })).rejects.toThrow("broadcast");
		await first.stop();
		await second.stop();
	});
});

describe("claims and labels", () => {
	test("conflicts on the same logical path across worktrees", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));
		expect((await first.claim(["src/api"])).claimed).toEqual(["src/api"]);
		const conflict = await second.claim(["src/api"]);
		expect(conflict.claimed).toEqual([]);
		expect(conflict.conflicts[0]).toMatchObject({ path: "src/api", ownerLabel: "frontend" });
		expect((await second.release(["src/api"])).notOwned).toEqual(["src/api"]);
		await first.stop();
		await second.stop();
	});

	test("joins under a unique label", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));
		expect((await first.join({ label: "ui", listen: false })).label).toBe("ui");
		await expect(second.join({ label: "ui", listen: false })).rejects.toThrow("already in use");
		await first.stop();
		await second.stop();
	});
});

describe("the inbox watch", () => {
	/** A frontend peer and an armed backend, with the backend's mail calls recorded. */
	async function pair(dir: string) {
		const now = () => 1_000;
		const frontend = bus(dir, "/repo/frontend", now);
		const backend = bus(dir, "/repo/backend", now);
		await acting(frontend, context("/repo/frontend", "s1", "frontend"));
		await acting(backend, context("/repo/backend", "s2", "backend", "json"));
		// A non-TUI session opts into the bus on its first use, so it is addressable.
		await backend.status();
		const calls: number[] = [];
		backend.onWake = () => calls.push(calls.length + 1);
		return { frontend, backend, calls };
	}

	test("queues new mail once and leaves it on disk", async () => {
		const dir = busDir();
		const { frontend, backend, calls } = await pair(dir);
		expect((await backend.join({ wake: true })).watching).toEqual({ armed: true, wake: true });
		await frontend.send({ to: "backend", text: "contract v2" });
		await backend.poll();
		expect(backend.pending().map((message) => message.text)).toEqual(["contract v2"]);
		expect(calls).toHaveLength(1);
		await backend.poll();
		expect(backend.pending()).toHaveLength(1);
		expect(calls).toHaveLength(1);
		expect(await createBusStore({ dir }).unread("s2")).toBe(1);
		await frontend.stop();
		await backend.stop();
	});

	test("a watch without wake queues mail and leaves the turn alone", async () => {
		const dir = busDir();
		const { frontend, backend, calls } = await pair(dir);
		await backend.join({});
		await frontend.send({ to: "backend", text: "next turn, please" });
		await backend.poll();
		expect(backend.pending().map((message) => message.text)).toEqual(["next turn, please"]);
		expect(calls).toEqual([]);
		await frontend.stop();
		await backend.stop();
	});

	test("a message read with inbox is never announced afterwards", async () => {
		const dir = busDir();
		const { frontend, backend, calls } = await pair(dir);
		await backend.join({ wake: true });
		await frontend.send({ to: "backend", text: "read me first" });
		expect(await backend.inbox()).toHaveLength(1);
		await backend.poll();
		expect(backend.pending()).toEqual([]);
		expect(calls).toEqual([]);
		await frontend.stop();
		await backend.stop();
	});

	test("reports a broadcast once, whatever the number of recipients", async () => {
		const dir = busDir();
		const { frontend, backend } = await pair(dir);
		const third = bus(dir, "/repo/third", () => 1_000);
		await acting(third, context("/repo/third", "s3", "third"));
		await backend.join({ wake: true });
		await frontend.send({ to: "*", kind: "event", text: "build failed" });
		await backend.poll();
		expect(backend.pending().map((message) => message.kind)).toEqual(["event"]);
		await frontend.stop();
		await backend.stop();
		await third.stop();
	});

	test("the record says whether this session is listening, so a peer reads it from disk", async () => {
		const dir = busDir();
		const { frontend, backend } = await pair(dir);
		const store = createBusStore({ dir });
		await backend.join({ wake: true });
		expect((await store.session("s2"))?.watching).toEqual({ armed: true, wake: true });
		// The peer reads it in the status rows it already asks for, not a second call.
		const seen = (await frontend.status()).sessions.find((session) => session.id === "s2");
		expect(seen?.watching).toEqual({ armed: true, wake: true });
		await backend.join({ listen: false });
		expect((await store.session("s2"))?.watching).toBeUndefined();
		await frontend.stop();
		await backend.stop();
	});

	test("arming is idempotent, an explicit wake sets the mode, and stop is safe when unarmed", async () => {
		const dir = busDir();
		const { backend } = await pair(dir);
		expect((await backend.join({ wake: true })).watching).toEqual({ armed: true, wake: true });
		// An omitted `wake` keeps an armed watch's mode.
		expect((await backend.join({})).watching).toEqual({ armed: true, wake: true });
		expect((await backend.join({ wake: false })).watching).toEqual({ armed: true, wake: false });
		expect((await backend.status()).watching).toEqual({ armed: true, wake: false });
		expect((await backend.join({ wake: true })).watching).toEqual({ armed: true, wake: true });
		expect((await backend.status()).watching).toEqual({ armed: true, wake: true });
		expect((await backend.join({ listen: false })).watching).toEqual({ armed: false, wake: false });
		expect((await backend.join({ listen: false })).watching).toEqual({ armed: false, wake: false });
		expect((await backend.status()).watching).toBeUndefined();
		await backend.stop();
	});

	test("enabling wake over mail already queued signals that burst", async () => {
		const dir = busDir();
		const { frontend, backend, calls } = await pair(dir);
		await backend.join({});
		await frontend.send({ to: "backend", text: "queued first" });
		await backend.poll();
		expect(backend.pending()).toHaveLength(1);
		expect(calls).toEqual([]);

		await backend.join({ wake: true });
		expect(calls).toHaveLength(1);

		await frontend.stop();
		await backend.stop();
	});

	test("the ticker starts on arm and stops on disarm and shutdown", async () => {
		const dir = busDir();
		const ticks: Array<() => void> = [];
		let stopped = 0;
		const backend = createSessionBus({} as ExtensionAPI, {
			dir,
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 0,
			interval: (_ms, tick) => {
				ticks.push(tick);
				return () => {
					stopped += 1;
				};
			},
		});
		await acting(backend, context("/repo/backend", "s2", "backend"));
		await backend.join({});
		expect(ticks).toHaveLength(1);
		await backend.join({ listen: false });
		expect(stopped).toBe(1);
		await backend.join({});
		await backend.stop();
		expect(stopped).toBe(2);
	});

	test("reported mail leaves the queue but stays unread until inbox runs", async () => {
		const dir = busDir();
		const { frontend, backend } = await pair(dir);
		await backend.join({});
		await frontend.send({ to: "backend", text: "notice me" });
		await backend.poll();
		const [message] = backend.pending();
		if (!message) throw new Error("the message was not queued");
		backend.markReported([message.id]);
		expect(backend.pending()).toEqual([]);
		await backend.poll();
		expect(backend.pending()).toEqual([]);
		expect(await backend.inbox()).toHaveLength(1);
		await frontend.stop();
		await backend.stop();
	});

	test("nothing is queued while the watch is off", async () => {
		const dir = busDir();
		const { frontend, backend, calls } = await pair(dir);
		await frontend.send({ to: "backend", text: "ignored" });
		await backend.poll();
		expect(backend.pending()).toEqual([]);
		expect(calls).toEqual([]);
		await frontend.stop();
		await backend.stop();
	});
});

describe("pruning", () => {
	test("drops a stale peer on status", async () => {
		const dir = busDir();
		let now = 1_000;
		const first = bus(dir, "/repo/frontend", () => now);
		const second = bus(dir, "/repo/backend", () => now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));
		now = 1_000_000;
		const status = await first.status();
		expect(status.sessions.map((session) => session.id)).toEqual(["s1"]);
		await first.stop();
		await second.stop();
	});
});

describe("board reads", () => {
	test("peek reads mail without consuming or queueing it", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const frontend = bus(dir, "/repo/frontend", now);
		const backend = bus(dir, "/repo/backend", now);
		await acting(frontend, context("/repo/frontend", "s1", "frontend"));
		await acting(backend, context("/repo/backend", "s2", "backend"));
		await backend.join({});
		await frontend.send({ to: "backend", text: "preview me" });

		expect((await backend.peek()).map((message) => message.text)).toEqual(["preview me"]);
		// Nothing is queued for a report and nothing was deleted: `inbox` still owns both.
		expect(backend.pending()).toEqual([]);
		expect(await createBusStore({ dir }).unread("s2")).toBe(1);
		expect(await backend.inbox()).toHaveLength(1);
		await frontend.stop();
		await backend.stop();
	});

	test("releaseStored releases a stored path that a cwd-relative release would rewrite", async () => {
		const dir = busDir();
		const root = "/repo/frontend";
		const frontend = bus(dir, root, () => 1_000);
		await acting(frontend, context(`${root}/src`, "s1", "frontend"));
		const store = createBusStore({ dir });
		await store.claimAll(["src/api"], "s1", "frontend", 1_000);

		// A normalizing release resolves `src/api` against `/repo/frontend/src`.
		expect(await frontend.release(["src/api"])).toEqual({ released: [], notOwned: ["src/src/api"] });
		expect(await frontend.releaseStored("src/api")).toBe(true);
		expect(await store.claims()).toEqual([]);
		await frontend.stop();
	});

	test("releaseStored never releases another session's claim", async () => {
		const dir = busDir();
		const frontend = bus(dir, "/repo/frontend", () => 1_000);
		const backend = bus(dir, "/repo/backend", () => 1_000);
		await acting(frontend, context("/repo/frontend", "s1", "frontend"));
		await acting(backend, context("/repo/backend", "s2", "backend"));
		await frontend.claim(["src/api"]);

		expect(await backend.releaseStored("src/api")).toBe(false);
		expect((await createBusStore({ dir }).claims()).map((claim) => claim.path)).toEqual(["src/api"]);
		await frontend.stop();
		await backend.stop();
	});
});

describe("snapshot", () => {
	test("shows the live bus and this session without writing or pruning", async () => {
		const dir = busDir();
		let now = 1_000;
		const first = bus(dir, "/repo/frontend", () => now);
		const second = bus(dir, "/repo/backend", () => now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));
		await second.claim(["src/api"]);
		await first.join({ wake: true });
		await second.send({ to: "frontend", text: "notice me" });

		const live = await first.snapshot();
		expect(live.sessions.map((session) => session.label).sort()).toEqual(["backend", "frontend"]);
		expect(live.sessions.find((session) => session.id === "s1")?.unread).toBe(1);
		expect(live.claims.map((claim) => claim.path)).toEqual(["src/api"]);
		expect(live.watching).toEqual({ armed: true, wake: true });

		now = 1_000_000;
		const stale = await first.snapshot();
		// This session is always on its own board; the stale peer and its claim are not.
		expect(stale.sessions.map((session) => session.id)).toEqual(["s1"]);
		expect(stale.claims).toEqual([]);

		// Nothing was deleted, so the next `status` is what prunes.
		const store = createBusStore({ dir });
		expect((await store.sessions()).map((session) => session.id).sort()).toEqual(["s1", "s2"]);
		expect(await store.claims()).toHaveLength(1);
		await first.status();
		expect((await store.sessions()).map((session) => session.id)).toEqual(["s1"]);
		expect(await store.claims()).toEqual([]);

		await first.stop();
		await second.stop();
	});

	test("refuses to read a bus that never started", async () => {
		await expect(bus(busDir(), "/repo/frontend", () => 1_000).snapshot()).rejects.toThrow("not started");
	});
});

describe("labels", () => {
	const stale = (id: string, label: string) => ({
		id,
		label,
		pid: 1,
		cwd: "/repo",
		repoRoot: "/repo",
		mode: "tui" as const,
		startedAt: 0,
		lastSeen: -3_600_000,
	});

	test("a stale record's label is free at join, and a peer reaches it by name", async () => {
		const dir = busDir();
		const store = createBusStore({ dir });
		await store.ensure();
		await store.writeSession(stale("gone", "lead"));

		const lead = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await acting(lead, context("/repo", "s9", "lead"));
		expect((await lead.status()).me.label).toBe("lead");

		const peer = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await acting(peer, context("/repo", "s10", "peer"));
		expect((await peer.send({ to: "lead", text: "hi" })).delivered).toEqual(["lead"]);
		await lead.stop();
		await peer.stop();
	});

	test("joins onto a stale session's label instead of refusing it", async () => {
		const dir = busDir();
		const store = createBusStore({ dir });
		await store.ensure();
		await store.writeSession(stale("gone", "lead"));

		const session = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await acting(session, context("/repo", "s1", "mine"));
		expect((await session.join({ label: "lead", listen: false })).label).toBe("lead");
		await session.stop();
	});

	test("two joins in the same instant end with distinct labels", async () => {
		const dir = busDir();
		const first = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		const second = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await Promise.all([acting(first, context("/repo", "s1", "lead")), acting(second, context("/repo", "s2", "lead"))]);
		const labels = (await createBusStore({ dir }).sessions()).map((session) => session.label).sort();
		// A canary for the race, not a proof of it: whichever session the scheduler lets
		// in second yields, so the property is distinctness rather than order.
		expect(labels).toHaveLength(2);
		expect(new Set(labels).size).toBe(2);
		expect(labels.every((label) => /^lead(-s[12])?$/.test(label))).toBe(true);
		await first.stop();
		await second.stop();
	});

	test("a duplicate at the label limit still ends distinct", async () => {
		const dir = busDir();
		const name = "l".repeat(40);
		const first = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		const second = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await acting(first, context("/repo", "s1", name));
		await acting(second, context("/repo", "s2", name));
		const labels = (await createBusStore({ dir }).sessions()).map((session) => session.label).sort();
		expect(labels).toEqual([`${"l".repeat(37)}-s2`, name]);
		await first.stop();
		await second.stop();
	});

	test("two joins to one label in the same instant end distinct", async () => {
		const dir = busDir();
		const first = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		const second = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await acting(first, context("/repo", "s1", "one"));
		await acting(second, context("/repo", "s2", "two"));
		// Either rename may be refused or yield; neither may leave two sessions named lead.
		await Promise.all([
			first.join({ label: "lead", listen: false }).catch(() => "refused"),
			second.join({ label: "lead", listen: false }).catch(() => "refused"),
		]);
		const labels = (await createBusStore({ dir }).sessions()).map((session) => session.label);
		expect(new Set(labels).size).toBe(2);
		expect(labels.filter((label) => label === "lead").length).toBeLessThanOrEqual(1);
		await first.stop();
		await second.stop();
	});
});

describe.skipIf(!canCreateSymlinks())("symlinked paths", () => {
	test("the cwd a session records is its real path", async () => {
		const real = busDir();
		const link = temps.track(join(dirname(real), `${basename(real)}-link`));
		symlinkSync(real, link, "dir");

		const session = runtime(real);
		await acting(session, context(link, "s1", "linked"));
		expect((await session.status()).sessions[0]?.cwd).toBe(realpathSync.native(link));
		expect((await session.claim(["src/api"])).claimed).toEqual(["src/api"]);
		await session.stop();
	});

	test("a link inside the repository and its target are one claim", async () => {
		const dir = busDir();
		mkdirSync(join(dir, "target"), { recursive: true });
		symlinkSync(join(dir, "target"), join(dir, "link"), "dir");

		const first = runtime(dir);
		await acting(first, context(dir, "s1", "one"));
		expect((await first.claim(["link/src/api.ts"])).claimed).toEqual(["target/src/api.ts"]);

		const second = runtime(dir);
		await acting(second, context(dir, "s2", "two"));
		const blocked = await second.claim(["target/src/api.ts"]);
		expect(blocked.claimed).toEqual([]);
		expect(blocked.conflicts[0]?.ownerLabel).toBe("one");

		const outside = busDir();
		symlinkSync(outside, join(dir, "escape"), "dir");
		expect(
			await second.claim(["escape/secret.ts"]).then(
				() => "claimed",
				(error: Error) => error.message,
			),
		).toContain("does not resolve to a file in the repository");

		// A message's paths and a release are keyed by the target too, not just a claim.
		await first.send({ to: "two", text: "paths", paths: ["link/src/api.ts"] });
		expect((await second.inbox(5)).map((entry) => entry.paths)).toEqual([["target/src/api.ts"]]);
		expect(await first.release(["link/src/api.ts"])).toEqual({ released: ["target/src/api.ts"], notOwned: [] });
		await first.stop();
		await second.stop();
	});
});

describe("heartbeat", () => {
	/** A heartbeat writes without being awaited, so a test waits for the record instead. */
	async function until(read: () => Promise<boolean>): Promise<void> {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			if (await read()) return;
			await settle(2);
		}
		throw new Error("the heartbeat's write did not land");
	}

	test("a session whose heartbeat fires outlives a TTL a silent one does not", async () => {
		const dir = busDir();
		let now = 1_000;
		const ticks: Array<() => void> = [];
		const live = runtime(dir, {
			repo: { root: "/repo", key: "shared" },
			now: () => now,
			heartbeatMs: 10,
			interval: (_ms, callback) => {
				ticks.push(callback);
				return () => {};
			},
		});
		// The same interval that is recorded and never called: a heartbeat that died.
		const silent = runtime(dir, {
			repo: { root: "/repo", key: "shared" },
			now: () => now,
			heartbeatMs: 10,
			interval: () => () => {},
		});
		await acting(live, context("/repo", "h1", "live"));
		await acting(silent, context("/repo", "h2", "silent"));

		now += 1_000;
		const store = createBusStore({ dir });
		for (const tick of ticks) tick();
		await until(async () =>
			(await store.sessions()).some((session) => session.id === "h1" && session.lastSeen === now),
		);

		const reader = runtime(dir, { repo: { root: "/repo", key: "shared" }, now: () => now, sessionTtlMs: 50 });
		await acting(reader, context("/repo", "h3", "reader"));
		expect((await reader.status()).sessions.map((session) => session.label).sort()).toEqual(["live", "reader"]);
		await live.stop();
		await silent.stop();
		await reader.stop();
	});

	test("a session that revived after its label was taken yields on the next tick", async () => {
		const dir = busDir();
		let now = 1_000;
		const ticks: Array<() => void> = [];
		const revived = runtime(dir, {
			repo: { root: "/repo", key: "shared" },
			now: () => now,
			heartbeatMs: 10,
			interval: (_ms, callback) => {
				ticks.push(callback);
				return () => {};
			},
		});
		await acting(revived, context("/repo", "s1", "lead"));

		// A peer took the label while this session slept past its TTL.
		const store = createBusStore({ dir });
		await store.writeSession({
			id: "s2",
			label: "lead",
			pid: 2,
			cwd: "/repo",
			repoRoot: "/repo",
			mode: "tui",
			startedAt: now,
			lastSeen: now,
		});

		now += 1_000;
		for (const tick of ticks) tick();
		await until(async () => (await store.sessions()).find((session) => session.id === "s1")?.label !== "lead");
		expect((await store.sessions()).map((session) => session.label).sort()).toEqual(["lead", "lead-s1"]);
		await revived.stop();
	});

	test("a session that names itself instead of acting still heartbeats, once", async () => {
		const dir = busDir();
		const ticks: Array<() => void> = [];
		const named = runtime(dir, {
			repo: { root: "/repo", key: "shared" },
			now: () => 1_000,
			heartbeatMs: 10,
			interval: (_ms, callback) => {
				ticks.push(callback);
				return () => {};
			},
		});
		// A headless session joins by naming itself, which is not the join-bus path,
		// so the heartbeat has to be armed here too or it goes stale while idle.
		await named.start(context("/repo", "s1", "lead", "json"));
		await named.join({ label: "lead", listen: false });
		expect(ticks).toHaveLength(1);
		// A later reader must not arm a second ticker.
		await named.status();
		expect(ticks).toHaveLength(1);
		await named.stop();
	});
});

// The runtime reaches git only through `exec`, so this fake needs nothing else.
const realGit = {
	exec: (command: string, args: string[], options?: { cwd?: string }) => execP(command, args, options),
} as unknown as ExtensionAPI;

describe.skipIf(!runSlowSuites)("a real repository", () => {
	test("two worktrees of one repository share a bus and conflict on one relative path", async () => {
		const repo = temps.track(await makeRepo("pi-session-bus-repo-"));
		const worktree = temps.track(join(dirname(repo), `${basename(repo)}-wt`));
		await execP("git", ["worktree", "add", "-q", "-b", "side", worktree], { cwd: repo });

		const dir = busDir();
		const main = createSessionBus(realGit, { dir, heartbeatMs: 0, watchMs: 0 });
		const side = createSessionBus(realGit, { dir, heartbeatMs: 0, watchMs: 0 });
		await acting(main, context(repo, "w1", "frontend"));
		await acting(side, context(worktree, "w2", "backend"));
		expect((await main.status()).sessions.map((session) => session.label).sort()).toEqual(["backend", "frontend"]);

		expect((await side.claim(["src/api"])).claimed).toEqual(["src/api"]);
		const blocked = await main.claim(["src/api"]);
		expect(blocked.claimed).toEqual([]);
		expect(blocked.conflicts[0]?.ownerLabel).toBe("backend");
		// A directory claim covers a peer's file inside it.
		expect((await main.claim(["src"])).conflicts[0]?.path).toBe("src");
		await main.stop();
		await side.stop();
	});

	test.skipIf(!canCreateSymlinks())("a cwd spelled through a symlink claims its own repository", async () => {
		const repo = temps.track(await makeRepo("pi-session-bus-repo-"));
		const link = temps.track(join(dirname(repo), `${basename(repo)}-link`));
		symlinkSync(repo, link, "dir");

		const dir = busDir();
		const linked = createSessionBus(realGit, { dir, heartbeatMs: 0, watchMs: 0 });
		await acting(linked, context(link, "l1", "linked"));
		expect((await linked.claim(["src/api"])).claimed).toEqual(["src/api"]);
		await linked.stop();
	});
});
