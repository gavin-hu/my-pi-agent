import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBusStore } from "./store.ts";
import type { BusMessage, SessionRecord } from "./types.ts";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "pi-session-bus-"));
	dirs.push(dir);
	const store = createBusStore({ dir });
	return { dir, store };
}

const session = (id: string, lastSeen = 100): SessionRecord => ({
	id,
	label: id,
	pid: 1,
	cwd: "/repo",
	repoRoot: "/repo",
	mode: "tui",
	startedAt: 50,
	lastSeen,
});

const message = (id: string, to: string, at = 100): BusMessage => ({
	id,
	from: "s1",
	fromLabel: "one",
	to,
	toLabel: "two",
	kind: "message",
	text: "hello",
	at,
});

describe("sessions", () => {
	test("writes and reads one record per session, tolerating a corrupt file", async () => {
		const { store } = fixture();
		await store.ensure();
		await store.writeSession(session("s1"));
		await store.writeSession(session("s2"));
		const sessions = await store.sessions();
		expect(sessions.map((entry) => entry.id).sort()).toEqual(["s1", "s2"]);
		expect(await store.unread("missing")).toBe(0);
	});

	test("removes a session", async () => {
		const { store } = fixture();
		await store.writeSession(session("s1"));
		await store.removeSession("s1");
		expect(await store.sessions()).toEqual([]);
	});
});

describe("inbox", () => {
	test("stores one file per message, consumes oldest first, and counts unread", async () => {
		const { store } = fixture();
		await store.writeMessage("s2", message("100-a", "s2"));
		await store.writeMessage("s2", message("101-b", "s2"));
		expect(await store.unread("s2")).toBe(2);
		const first = await store.inbox("s2", 1);
		expect(first.map((entry) => entry.id)).toEqual(["100-a"]);
		expect(await store.unread("s2")).toBe(1);
		const rest = await store.inbox("s2", 10);
		expect(rest.map((entry) => entry.id)).toEqual(["101-b"]);
		expect(await store.inbox("s2", 10)).toEqual([]);
	});
});

describe("claims", () => {
	test("is idempotent for the owner and conflicts for another", async () => {
		const { store } = fixture();
		const first = await store.claim("src/a.ts", "s1", "one", 100);
		expect(first.conflict).toBeUndefined();
		const again = await store.claim("src/a.ts", "s1", "one", 101);
		expect(again.conflict).toBeUndefined();
		const other = await store.claim("src/a.ts", "s2", "two", 102);
		expect(other.conflict?.owner).toBe("s1");
		expect(await store.release("src/a.ts", "s2")).toBe(false);
		expect(await store.release("src/a.ts", "s1")).toBe(true);
		expect(await store.claim("src/a.ts", "s2", "two", 103)).toHaveProperty("claim");
	});

	test("releases all claims owned by a session", async () => {
		const { store } = fixture();
		await store.claim("src/a.ts", "s1", "one", 100);
		await store.claim("src/b.ts", "s2", "two", 100);
		expect(await store.releaseAll("s1")).toEqual(["src/a.ts"]);
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/b.ts"]);
	});
});

describe("prune", () => {
	test("removes stale sessions, their claims, and expired messages", async () => {
		const { store } = fixture();
		await store.writeSession(session("s1", 100));
		await store.writeMessage("s2", message("100-a", "s2", 100));
		await store.claim("src/a.ts", "s1", "one", 100);
		await store.prune({ now: 1_000, activeIds: new Set(["s1", "s2"]), sessionTtlMs: 500, messageTtlMs: 500 });
		expect(await store.sessions()).toEqual([]);
		expect(await store.claims()).toEqual([]);
		expect(await store.inbox("s2", 10)).toEqual([]);
	});

	test("keeps fresh sessions and claims", async () => {
		const { store } = fixture();
		await store.writeSession(session("s1", 900));
		await store.claim("src/a.ts", "s1", "one", 900);
		await store.prune({ now: 1_000, activeIds: new Set(["s1"]), sessionTtlMs: 500, messageTtlMs: 500 });
		expect(await store.sessions()).toHaveLength(1);
		expect(await store.claims()).toHaveLength(1);
	});
});
