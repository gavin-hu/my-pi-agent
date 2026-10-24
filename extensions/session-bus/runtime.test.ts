import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir } from "../../test/helpers/env.ts";
import { splitStore, SPLIT_TEAM } from "../../test/helpers/fixtures/split.ts";
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
 * Join by acting: arming and disarming the inbox watch is an addressable action,
 * so it puts the session on the bus under its own name — yielding a suffix when
 * that name is taken — and leaves no state behind.
 */
async function acting(session: SessionBus, ctx: ExtensionContext): Promise<void> {
	await session.start(ctx);
	await session.watch({ stop: true });
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
		await worker.rename("backend");
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

describe("joining a unit of an approved split", () => {
	test("claims every path the unit owns", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			const joined = await owner.join({ team, unit: "core" });
			expect(joined).toMatchObject({ team, unit: "core", claimed: ["src/core"], conflicts: [] });
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("joining twice is idempotent", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			await owner.join({ team, unit: "core" });
			const again = await owner.join({ team, unit: "core" });
			expect(again.conflicts).toEqual([]);
			expect(again.claimed).toEqual(["src/core"]);
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("a second session on a taken unit is told who holds it", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const first = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			const second = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(first, context("/repo", "s1", "core"));
			await acting(second, context("/repo", "s2", "core-two"));
			await first.join({ team, unit: "core" });
			const refused = await second.join({ team, unit: "core" });
			expect(refused.conflicts).toEqual([expect.objectContaining({ path: "src/core", ownerLabel: "core" })]);
			await first.stop();
			await second.stop();
		} finally {
			restore();
		}
	});

	test("honours a project switch set at the repository root, from a nested cwd", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		const root = temps.track(tempDir("pi-split-root-"));
		try {
			// The switch is off globally and only the repository root turns it on.
			mkdirSync(join(root, ".pi"), { recursive: true });
			writeFileSync(join(root, ".pi", "bytefly.json"), JSON.stringify({ plan: { split: true } }));
			const nested = runtime(dir, { repo: { root, key: "shared" }, plans });
			await acting(nested, context(join(root, "packages", "web"), "s1", "core"));
			const joined = await nested.join({ team, unit: "core" });
			expect(joined.claimed).toEqual(["src/core"]);
			await nested.stop();
		} finally {
			restore();
		}
	});

	test("refuses while the switch is off, naming it", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps, SPLIT_TEAM, { on: false });
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			await expect(owner.join({ team, unit: "core" })).rejects.toThrow(/plan\.split/);
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("names the units a plan actually has", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			await expect(owner.join({ team, unit: "report" })).rejects.toThrow(/contract, core/);
			await expect(owner.join({ team: "nope", unit: "core" })).rejects.toThrow(/No split plan named/);
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("refuses a plan with no team section", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps, SPLIT_TEAM, {
			content: "# Plain\n\n## Steps\n\n- [ ] one",
		});
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			await expect(owner.join({ team, unit: "core" })).rejects.toThrow(/no team section/);
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("leaving releases the unit's paths, and everything when no unit is named", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			await owner.join({ team, unit: "core" });
			expect(await owner.leave({ team, unit: "core" })).toEqual({ released: ["src/core"], notOwned: [] });
			await owner.join({ team, unit: "core" });
			await owner.claim(["src/other"]);
			expect((await owner.leave({})).released.sort()).toEqual(["src/core", "src/other"]);
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("claims the unit's paths from the repository root, not the session cwd", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			// A session started below the top: its cwd is not the repo root.
			const nested = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(nested, context("/repo/packages/web", "s1", "core"));
			const joined = await nested.join({ team, unit: "core" });
			expect(joined.claimed).toEqual(["src/core"]);
			await nested.stop();
		} finally {
			restore();
		}
	});

	test("status reports the newest split and who holds each unit", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const first = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(first, context("/repo", "s1", "contract"));
			await first.join({ team, unit: "contract" });
			const status = await first.status();
			expect(status.units).toMatchObject({
				team,
				joined: 1,
				total: 2,
				rows: [{ unit: "contract", lead: true, holder: "contract" }, { unit: "core" }],
			});
			await first.stop();
		} finally {
			restore();
		}
	});

	test("refuses an owner's claim on a shared file, names the lead, and writes nothing", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			await owner.join({ team, unit: "core" });
			await expect(owner.claim(["package.json"])).rejects.toThrow(
				'package.json is a shared file; only the lead "contract" may claim it.',
			);
			// All or nothing: the session still holds exactly what it joined.
			const status = await owner.status();
			expect(status.claims.map((claim) => claim.path)).toEqual(["src/core"]);
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("the lead keeps the shared files, and an owner keeps its own paths", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const lead = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(lead, context("/repo", "s1", "contract"));
			await acting(owner, context("/repo", "s2", "core"));
			await lead.join({ team, unit: "contract" });
			await owner.join({ team, unit: "core" });
			expect((await lead.claim(["package.json"])).claimed).toEqual(["package.json"]);
			expect((await owner.claim(["src/core/routes.ts"])).claimed).toEqual(["src/core/routes.ts"]);
			await lead.stop();
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("leaves a session that never joined a unit alone", async () => {
		const dir = busDir();
		const { plans, restore } = splitStore(temps);
		try {
			const solo = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(solo, context("/repo", "s1", "solo"));
			expect((await solo.claim(["package.json"])).claimed).toEqual(["package.json"]);
			await solo.stop();
		} finally {
			restore();
		}
	});

	test("a shared file is claimable again after leaving the unit", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const owner = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(owner, context("/repo", "s1", "core"));
			await owner.join({ team, unit: "core" });
			await owner.leave({ team, unit: "core" });
			expect((await owner.claim(["package.json"])).claimed).toEqual(["package.json"]);
			await owner.stop();
		} finally {
			restore();
		}
	});

	test("a restored session is still held to the rule, because the claims are the record", async () => {
		const dir = busDir();
		const { plans, team, restore } = splitStore(temps);
		try {
			const first = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(first, context("/repo", "s1", "core"));
			await first.join({ team, unit: "core" });
			// A fresh worker for the same session: no in-memory membership survives it,
			// but its claims did, so the rule has to be read from them.
			const restored = runtime(dir, { repo: { root: "/repo", key: "shared" }, plans });
			await acting(restored, context("/repo", "s1", "core"));
			await expect(restored.claim(["package.json"])).rejects.toThrow(/only the lead "contract" may claim it/);
			await restored.stop();
		} finally {
			restore();
		}
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

	test("renames uniquely", async () => {
		const dir = busDir();
		const now = () => 1_000;
		const first = bus(dir, "/repo/frontend", now);
		const second = bus(dir, "/repo/backend", now);
		await acting(first, context("/repo/frontend", "s1", "frontend"));
		await acting(second, context("/repo/backend", "s2", "backend"));
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
		await acting(third, context("/repo/third", "s3", "third"));
		await backend.watch({ wake: true });
		await frontend.send({ to: "*", kind: "event", text: "build failed" });
		await backend.poll();
		expect(backend.pending().map((message) => message.kind)).toEqual(["event"]);
		await frontend.stop();
		await backend.stop();
		await third.stop();
	});

	test("arming is idempotent, an explicit wake sets the mode, and stop is safe when unarmed", async () => {
		const dir = busDir();
		const { backend } = await pair(dir);
		expect(await backend.watch({ wake: true })).toEqual({ armed: true, wake: true });
		// An omitted `wake` keeps an armed watch's mode.
		expect(await backend.watch({})).toEqual({ armed: true, wake: true });
		expect(await backend.watch({ wake: false })).toEqual({ armed: true, wake: false });
		expect((await backend.status()).watching).toEqual({ armed: true, wake: false });
		expect(await backend.watch({ wake: true })).toEqual({ armed: true, wake: true });
		expect((await backend.status()).watching).toEqual({ armed: true, wake: true });
		expect(await backend.watch({ stop: true })).toEqual({ armed: false, wake: false });
		expect(await backend.watch({ stop: true })).toEqual({ armed: false, wake: false });
		expect((await backend.status()).watching).toBeUndefined();
		await backend.stop();
	});

	test("enabling wake over mail already queued signals that burst", async () => {
		const dir = busDir();
		const { frontend, backend, calls } = await pair(dir);
		await backend.watch({});
		await frontend.send({ to: "backend", text: "queued first" });
		await backend.poll();
		expect(backend.pending()).toHaveLength(1);
		expect(calls).toEqual([]);

		await backend.watch({ wake: true });
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

	test("renames onto a stale session's label instead of refusing it", async () => {
		const dir = busDir();
		const store = createBusStore({ dir });
		await store.ensure();
		await store.writeSession(stale("gone", "lead"));

		const session = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await acting(session, context("/repo", "s1", "mine"));
		expect(await session.rename("lead")).toBe("lead");
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

	test("two renames to one label in the same instant end distinct", async () => {
		const dir = busDir();
		const first = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		const second = runtime(dir, { repo: { root: "/repo", key: "shared" } });
		await acting(first, context("/repo", "s1", "one"));
		await acting(second, context("/repo", "s2", "two"));
		// Either rename may be refused or yield; neither may leave two sessions named lead.
		await Promise.all([first.rename("lead").catch(() => "refused"), second.rename("lead").catch(() => "refused")]);
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
		await named.rename("lead");
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
