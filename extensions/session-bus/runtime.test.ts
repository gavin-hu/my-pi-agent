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

function bus(dir: string, root: string, now: () => number): SessionBus {
	return createSessionBus({} as ExtensionAPI, {
		dir,
		repo: { root, key: "shared" },
		now,
		heartbeatMs: 0,
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
