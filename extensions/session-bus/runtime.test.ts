import { afterAll, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createSessionBus, type SessionBus } from "./runtime.ts";
import { createBusStore } from "./store.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

function busDir(): string {
	return temps.track(tempDir("pi-session-bus-"));
}

function context(cwd: string, sessionId: string, sessionName: string, mode = "tui"): ExtensionContext {
	return fakeCtx({ cwd, sessionId, sessionName, mode, hasUI: mode === "tui" }).ctx as ExtensionContext;
}

function bus(dir: string, root: string, now: () => number, watchMs = 0): SessionBus {
	return createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root, key: "shared" },
		now,
		heartbeatMs: 0,
		watchMs,
	});
}

describe("registration", () => {
	test("a TUI session joins on start; a JSON session waits for a tool", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const terminal = bus(dir, "/repo/frontend", now);
		await terminal.start(context("/repo/frontend", "s1", "frontend"));
		const worker = bus(dir, "/repo/backend", now);
		await worker.start(context("/repo/backend", "s2", "backend", "json"));
		const store = createBusStore({ dir });
		expect((await store.sessions()).map((session) => session.id)).toEqual(["s1"]);
		// Status is the lazy join path for a non-terminal session.
		await worker.status();
		expect((await store.sessions()).map((session) => session.label).sort()).toEqual(["backend", "frontend"]);
		await terminal.stop();
		await worker.stop();
	});

	test("stop removes the record and releases claims", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await first.start(context("/repo/frontend", "s1", "frontend"));
		await second.start(context("/repo/backend", "s2", "backend"));
		expect((await first.claim(["src/api"])).claimed).toEqual(["src/api"]);
		await first.stop();
		const store = createBusStore({ dir });
		expect(await store.sessions()).toHaveLength(1);
		expect(await store.claims()).toEqual([]);
		await second.stop();
	});
});

describe("messages", () => {
	test("sends to a label and consumes once", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await first.start(context("/repo/frontend", "s1", "frontend"));
		await second.start(context("/repo/backend", "s2", "backend"));

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
		await first.start(context("/repo/frontend", "s1", "frontend"));
		await second.start(context("/repo/backend", "s2", "backend"));
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
		await first.start(context("/repo/frontend", "s1", "frontend"));
		await second.start(context("/repo/backend", "s2", "backend"));
		expect((await first.claim(["src/api"])).claimed).toEqual(["src/api"]);
		const conflict = await second.claim(["src/api"]);
		expect(conflict.claimed).toEqual([]);
		expect(conflict.conflicts[0]).toMatchObject({ path: "src/api", ownerLabel: "frontend" });
		expect((await second.release(["src/api"])).notOwned).toEqual(["src/api"]);
		await first.stop();
		await second.stop();
	});

	test("renames uniquely", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await first.start(context("/repo/frontend", "s1", "frontend"));
		await second.start(context("/repo/backend", "s2", "backend"));
		expect(await first.rename("ui")).toBe("ui");
		await expect(second.rename("ui")).rejects.toThrow("already in use");
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
		await frontend.start(context("/repo/frontend", "s1", "frontend"));
		await backend.start(context("/repo/backend", "s2", "backend", "json"));
		// A non-TUI session opts into the bus on its first use, so it is addressable.
		await backend.status();
		const calls: number[] = [];
		backend.onWake = () => calls.push(calls.length + 1);
		return { frontend, backend, calls };
	}

	test("queues new mail once and leaves it on disk", async () => {
		const dir = busDir();
		const { frontend, backend, calls } = await pair(dir);
		expect(await backend.watch({ wake: true })).toEqual({ armed: true, wake: true });
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
		await backend.watch({});
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
		await backend.watch({ wake: true });
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
		await third.start(context("/repo/third", "s3", "third"));
		await backend.watch({ wake: true });
		await frontend.send({ to: "*", kind: "event", text: "build failed" });
		await backend.poll();
		expect(backend.pending().map((message) => message.kind)).toEqual(["event"]);
		await frontend.stop();
		await backend.stop();
		await third.stop();
	});

	test("arming twice keeps the setting, and stop is safe when unarmed", async () => {
		const dir = busDir();
		const { backend } = await pair(dir);
		expect(await backend.watch({ wake: true })).toEqual({ armed: true, wake: true });
		expect(await backend.watch({})).toEqual({ armed: true, wake: true });
		expect((await backend.status()).watching).toEqual({ armed: true, wake: true });
		expect(await backend.watch({ stop: true })).toEqual({ armed: false, wake: false });
		expect(await backend.watch({ stop: true })).toEqual({ armed: false, wake: false });
		expect((await backend.status()).watching).toBeUndefined();
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
		await backend.start(context("/repo/backend", "s2", "backend"));
		await backend.watch({});
		expect(ticks).toHaveLength(1);
		await backend.watch({ stop: true });
		expect(stopped).toBe(1);
		await backend.watch({});
		await backend.stop();
		expect(stopped).toBe(2);
	});

	test("reported mail leaves the queue but stays unread until inbox runs", async () => {
		const dir = busDir();
		const { frontend, backend } = await pair(dir);
		await backend.watch({});
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
		await first.start(context("/repo/frontend", "s1", "frontend"));
		await second.start(context("/repo/backend", "s2", "backend"));
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
		await frontend.start(context("/repo/frontend", "s1", "frontend"));
		await backend.start(context("/repo/backend", "s2", "backend"));
		await backend.watch({});
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
		await frontend.start(context(`${root}/src`, "s1", "frontend"));
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
		await frontend.start(context("/repo/frontend", "s1", "frontend"));
		await backend.start(context("/repo/backend", "s2", "backend"));
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
		await first.start(context("/repo/frontend", "s1", "frontend"));
		await second.start(context("/repo/backend", "s2", "backend"));
		await second.claim(["src/api"]);
		await first.watch({ wake: true });
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
