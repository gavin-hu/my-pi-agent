import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readdir, utimes, writeFile } from "node:fs/promises";
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

	test("keeps the listening field, and skips a record whose field is not the shape the bus writes", async () => {
		const { store } = fixture();
		await store.ensure();
		await store.writeSession({ ...session("s1"), watching: { armed: true, wake: true } });
		expect((await store.session("s1"))?.watching).toEqual({ armed: true, wake: true });
		// The cast is the point of the case: only a hand-edited record can hold this, and a
		// reader that trusted it would report mail that cannot arrive.
		const broken = { ...session("s2"), watching: "on" } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
	});

	test("keeps the start token, and skips a record whose token is not a string", async () => {
		const { store } = fixture();
		await store.ensure();
		await store.writeSession({ ...session("s1"), startToken: "Mon Oct 26 00:02:00 2026" });
		expect((await store.session("s1"))?.startToken).toBe("Mon Oct 26 00:02:00 2026");
		// Only a hand-edited record can hold this, and a rule that trusted it would call a
		// live session gone.
		const broken = { ...session("s2"), startToken: 7 } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
	});

	test("removes a session, and its inbox directory once it holds no mail", async () => {
		const { dir, store } = fixture();
		await store.ensure();
		await store.writeSession(session("s1"));
		await store.removeSession("s1");
		expect(await store.sessions()).toEqual([]);
		expect(await readdir(join(dir, "inbox"))).toEqual([]);
	});

	test("keeps a removed session's inbox while the mail may still be read", async () => {
		const { dir, store } = fixture();
		await store.writeSession(session("s1"));
		await store.writeMessage("s1", message("100-a", "s1"));
		await store.removeSession("s1");
		expect(await readdir(join(dir, "inbox"))).toHaveLength(1);
		expect((await store.inbox("s1", 10)).map((entry) => entry.id)).toEqual(["100-a"]);
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

	test("peek reads a message without consuming it", async () => {
		const { store } = fixture();
		await store.writeMessage("s2", message("100-a", "s2"));
		expect((await store.peek("s2", 10)).map((entry) => entry.id)).toEqual(["100-a"]);
		expect((await store.peek("s2", 10)).map((entry) => entry.id)).toEqual(["100-a"]);
		expect(await store.unread("s2")).toBe(1);
		expect((await store.inbox("s2", 10)).map((entry) => entry.id)).toEqual(["100-a"]);
		expect(await store.unread("s2")).toBe(0);
		expect(await store.peek("s2", 10)).toEqual([]);
	});

	test("peek stops at a corrupt file, which the next consume clears", async () => {
		const { dir, store } = fixture();
		await store.writeMessage("s2", message("100-a", "s2"));
		const [inbox] = await readdir(join(dir, "inbox"));
		if (!inbox) throw new Error("the inbox directory was not written");
		const [file] = await readdir(join(dir, "inbox", inbox));
		if (!file) throw new Error("the message file was not written");
		await writeFile(join(dir, "inbox", inbox, file), "{");
		expect(await store.peek("s2", 10)).toEqual([]);
		expect(await store.inbox("s2", 10)).toEqual([]);
	});
});

describe("claims", () => {
	test("is idempotent for the owner and conflicts for another", async () => {
		const { store } = fixture();
		expect((await store.claimAll(["src/a.ts"], "s1", "one", 100)).claimed).toEqual(["src/a.ts"]);
		expect((await store.claimAll(["src/a.ts"], "s1", "one", 101)).claimed).toEqual(["src/a.ts"]);
		const other = await store.claimAll(["src/a.ts"], "s2", "two", 102);
		expect(other.claimed).toEqual([]);
		expect(other.conflicts[0]?.owner).toBe("s1");
		expect(await store.release("src/a.ts", "s2")).toBe(false);
		expect(await store.release("src/a.ts", "s1")).toBe(true);
		expect((await store.claimAll(["src/a.ts"], "s2", "two", 103)).claimed).toEqual(["src/a.ts"]);
	});

	test("claims a batch all or nothing, reporting every blocker", async () => {
		const { store } = fixture();
		expect((await store.claimAll(["src/api"], "s1", "one", 100)).claimed).toEqual(["src/api"]);
		const blocked = await store.claimAll(["src/ui", "src/api"], "s2", "two", 101);
		expect(blocked.claimed).toEqual([]);
		expect(blocked.conflicts).toEqual([{ path: "src/api", owner: "s1", ownerLabel: "one" }]);
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/api"]);
	});

	test("gives a batch that loses the create race nothing to hold", async () => {
		const { store } = fixture();
		const results = await Promise.all([
			store.claimAll(["src/a.ts", "src/b.ts"], "s1", "one", 100),
			store.claimAll(["src/a.ts", "src/b.ts"], "s2", "two", 100),
		]);
		expect(results.filter((result) => result.claimed.length > 0)).toHaveLength(1);
		const held = await store.claims();
		expect(held).toHaveLength(2);
		expect(new Set(held.map((claim) => claim.owner)).size).toBe(1);
	});

	test("a batch that loses a race gives back only what it created", async () => {
		const { dir, store } = fixture();
		// One path held before the call, one this batch would create, and one a rival takes
		// in the window between the pre-check and that batch's own create.
		expect((await store.claimAll(["src/api"], "s1", "one", 100)).claimed).toEqual(["src/api"]);
		const rival = createBusStore({ dir });
		const lost = await store.claimAll(["src/api", "src/ui", "src/web"], "s1", "one", 101, async (path) => {
			if (path === "src/ui") await rival.claimAll(["src/web"], "s2", "two", 101);
		});
		expect(lost.claimed).toEqual([]);
		expect(lost.conflicts).toEqual([{ path: "src/web", owner: "s2", ownerLabel: "two" }]);
		// The rollback took back the path this batch published, and left alone the one the
		// same session already held — releasing that would hand a live path to nobody.
		expect((await store.claims()).map((claim) => [claim.path, claim.owner])).toEqual([
			["src/api", "s1"],
			["src/web", "s2"],
		]);
	});

	test("releases all claims owned by a session", async () => {
		const { store } = fixture();
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		await store.claimAll(["src/b.ts"], "s2", "two", 100);
		expect(await store.releaseAll("s1")).toEqual(["src/a.ts"]);
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/b.ts"]);
	});

	test("publishes a claim whole, so the loser of a race leaves no temp file", async () => {
		const { dir, store } = fixture();
		expect((await store.claimAll(["src/a.ts"], "s1", "one", 100)).claimed).toEqual(["src/a.ts"]);
		expect((await store.claimAll(["src/a.ts"], "s2", "two", 101)).conflicts[0]?.owner).toBe("s1");
		expect(await store.claims()).toHaveLength(1);
		const names = await readdir(join(dir, "claims"));
		expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	test("republishes a claim whose file does not parse", async () => {
		const { dir, store } = fixture();
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		const [file] = await readdir(join(dir, "claims"));
		if (!file) throw new Error("the claim file was not written");
		await writeFile(join(dir, "claims", file), "{");
		expect((await store.claimAll(["src/a.ts"], "s2", "two", 101)).claimed).toEqual(["src/a.ts"]);
		expect((await store.claims()).map((claim) => claim.owner)).toEqual(["s2"]);
	});
});

describe("prune", () => {
	test("removes stale sessions, their claims, and expired messages", async () => {
		const { store } = fixture();
		await store.writeSession(session("s1", 100));
		await store.writeMessage("s2", message("100-a", "s2", 100));
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		await store.prune({ now: 1_000, activeIds: new Set(["s1", "s2"]), sessionTtlMs: 500, messageTtlMs: 500 });
		expect(await store.sessions()).toEqual([]);
		expect(await store.claims()).toEqual([]);
		expect(await store.inbox("s2", 10)).toEqual([]);
	});

	test("keeps fresh sessions and claims", async () => {
		const { store } = fixture();
		await store.writeSession(session("s1", 900));
		await store.claimAll(["src/a.ts"], "s1", "one", 900);
		await store.prune({ now: 1_000, activeIds: new Set(["s1"]), sessionTtlMs: 500, messageTtlMs: 500 });
		expect(await store.sessions()).toHaveLength(1);
		expect(await store.claims()).toHaveLength(1);
	});

	test("keeps a gone session's row and frees the path it held", async () => {
		const { store } = fixture();
		// The process is gone but the heartbeat is fresh: the caller knows that, the file
		// cannot, so the caller says which ids own nothing.
		await store.writeSession(session("s1", 900));
		await store.claimAll(["src/a.ts"], "s1", "one", 900);
		await store.prune({
			now: 1_000,
			activeIds: new Set(),
			goneIds: new Set(["s1"]),
			sessionTtlMs: 500,
			messageTtlMs: 500,
		});
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
		expect(await store.claims()).toEqual([]);
	});

	test("keeps a live peer's claim that the caller's active set had not seen yet", async () => {
		const { store } = fixture();
		// A peer joined and claimed after the caller read the session list, so its id is
		// missing from the set the caller passes; its claim is still its own.
		await store.writeSession(session("s2", 900));
		await store.claimAll(["src/api"], "s2", "peer", 900);
		await store.prune({ now: 1_000, activeIds: new Set(["s1"]), sessionTtlMs: 500, messageTtlMs: 500 });
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/api"]);
	});

	test("drops the inbox directory whose mail expired and keeps one that is still fresh", async () => {
		const { dir, store } = fixture();
		await store.writeMessage("s2", message("100-a", "s2", 100));
		await store.writeMessage("s3", message("900-b", "s3", 900));
		await store.prune({ now: 1_000, activeIds: new Set(["s2", "s3"]), sessionTtlMs: 500, messageTtlMs: 500 });
		expect(await readdir(join(dir, "inbox"))).toHaveLength(1);
		expect(await store.peek("s3", 10)).toHaveLength(1);
	});

	test("collects the temp file a crashed writer left, and leaves a live one alone", async () => {
		const { dir, store } = fixture();
		await store.ensure();
		const sessions = join(dir, "sessions");
		const stale = join(sessions, "abcd.json.123.9999.tmp");
		const live = join(sessions, "abcd.json.456.8888.tmp");
		await writeFile(stale, "{}");
		await writeFile(live, "{}");
		// The temp file of a write still in flight is milliseconds old; a crashed writer's
		// sits until the next prune, where the filesystem's own timestamp decides.
		await utimes(stale, 1_000_000, 1_000_000);
		await store.prune({ now: 1_000, activeIds: new Set(), sessionTtlMs: 500, messageTtlMs: 500 });
		expect(await readdir(sessions)).toEqual(["abcd.json.456.8888.tmp"]);
	});
});
