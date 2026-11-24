import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { storedName } from "../../lib/session-files.ts";
import { busMessage, busStoreFixture, sessionRecord, stampArrival, untoldOf } from "../../test/helpers/bus.ts";
import { makeTempTracker } from "../../test/helpers/git.ts";
import { createBusStore } from "./store.ts";
import type { ClaimConflict, SessionRecord } from "./types.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("sessions", () => {
	test("writes and reads one record per session, tolerating a corrupt file", async () => {
		const { store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession(sessionRecord("s1"));
		await store.writeSession(sessionRecord("s2"));
		const sessions = await store.sessions();
		expect(sessions.map((entry) => entry.id).sort()).toEqual(["s1", "s2"]);
		expect(await untoldOf(store.dir, "missing")).toBe(0);
	});

	test("keeps the listening field, and skips a record whose field is not the shape the bus writes", async () => {
		const { store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession({ ...sessionRecord("s1"), watching: { armed: true, wake: true } });
		expect((await store.session("s1"))?.watching).toEqual({ armed: true, wake: true });
		// The cast is the point of the case: only a hand-edited record can hold this, and a
		// reader that trusted it would report mail that cannot arrive.
		const broken = { ...sessionRecord("s2"), watching: "on" } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
	});

	test("keeps the start token, and skips a record whose token is not a string", async () => {
		const { store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession({ ...sessionRecord("s1"), startToken: "Mon Oct 26 00:02:00 2026" });
		expect((await store.session("s1"))?.startToken).toBe("Mon Oct 26 00:02:00 2026");
		// Only a hand-edited record can hold this, and a rule that trusted it would call a
		// live session gone.
		const broken = { ...sessionRecord("s2"), startToken: 7 } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
	});

	test("keeps the turn stamp, and skips a record whose stamp is not a number", async () => {
		const { store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession({ ...sessionRecord("s1"), turnAt: 7 });
		expect((await store.session("s1"))?.turnAt).toBe(7);
		// Only a hand-edited record can hold this. The roster drops the bad field and keeps the
		// row, because a page must still draw a teammate; the bus skips the record, the way it
		// already does for a bad `startToken` or `watching`, because a record it cannot read cannot
		// say who owns a path.
		const broken = { ...sessionRecord("s2"), turnAt: "working" } as unknown as SessionRecord;
		await store.writeSession(broken);
		expect((await store.sessions()).map((entry) => entry.id)).toEqual(["s1"]);
	});

	test("removes a session, and its inbox directory once it holds no mail", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.ensure();
		await store.writeSession(sessionRecord("s1"));
		await store.removeSession("s1");
		expect(await store.sessions()).toEqual([]);
		expect(await readdir(join(dir, "inbox"))).toEqual([]);
	});

	test("keeps a removed session's inbox while the mail may still be read", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.writeSession(sessionRecord("s1"));
		await store.writeMessage("s1", busMessage("100-a", "s1"));
		await store.removeSession("s1");
		expect(await readdir(join(dir, "inbox"))).toHaveLength(1);
		expect((await store.inbox("s1", 10)).messages.map((entry) => entry.id)).toEqual(["100-a"]);
	});
});

describe("inbox", () => {
	test("stores one file per message, consumes oldest first, and counts unread", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeMessage("s2", busMessage("100-a", "s2"));
		await store.writeMessage("s2", busMessage("101-b", "s2"));
		expect(await untoldOf(store.dir, "s2")).toBe(2);
		const first = await store.inbox("s2", 1);
		expect(first.messages.map((entry) => entry.id)).toEqual(["100-a"]);
		expect(await untoldOf(store.dir, "s2")).toBe(1);
		const rest = await store.inbox("s2", 10);
		expect(rest.messages.map((entry) => entry.id)).toEqual(["101-b"]);
		expect(await store.inbox("s2", 10)).toEqual({ messages: [], unreadable: [] });
	});

	test("a told id is not counted, and an id no file names changes nothing", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeMessage("s2", busMessage("100-a", "s2"));
		await store.writeMessage("s2", busMessage("101-b", "s2"));
		// What an announcement records: the files stay where they are, and the row's number stops
		// counting the one it announced. A stale id — a file consumed or expired since the record was
		// written — names nothing, so it takes nothing off.
		expect(await untoldOf(store.dir, "s2", ["100-a"])).toBe(1);
		expect(await untoldOf(store.dir, "s2", ["100-a", "999-z"])).toBe(1);
		expect(await untoldOf(store.dir, "s2", ["100-a", "101-b"])).toBe(0);
		expect((await store.peek("s2", { limit: 10 })).mail).toHaveLength(2);
	});

	test("a limit of zero reads nothing and consumes nothing", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeMessage("s2", busMessage("100-a", "s2"));
		// The page is decided before the front is read, so a caller that asked for no messages is
		// not handed the first one — and, on the consuming read, does not lose it either.
		expect(await store.inbox("s2", 0)).toEqual({ messages: [], unreadable: [] });
		expect(await store.peek("s2", { limit: 0 })).toEqual({ mail: [], unread: new Set(["100-a"]), unreadable: [] });
		expect(await untoldOf(store.dir, "s2")).toBe(1);
	});

	test("peek reads a message without consuming it", async () => {
		const { store } = busStoreFixture(temps);
		await store.writeMessage("s2", busMessage("100-a", "s2"));
		expect((await store.peek("s2", { limit: 10 })).mail.map((entry) => entry.id)).toEqual(["100-a"]);
		expect((await store.peek("s2", { limit: 10 })).mail.map((entry) => entry.id)).toEqual(["100-a"]);
		expect(await untoldOf(store.dir, "s2")).toBe(1);
		expect((await store.inbox("s2", 10)).messages.map((entry) => entry.id)).toEqual(["100-a"]);
		expect(await untoldOf(store.dir, "s2")).toBe(0);
		expect(await store.peek("s2", { limit: 10 })).toEqual({ mail: [], unread: new Set(), unreadable: [] });
	});

	test("peek pages from the front of the inbox, and skips the ids the caller has", async () => {
		const { store } = busStoreFixture(temps);
		for (let index = 0; index < 55; index += 1) {
			const at = 1_000 + index;
			await store.writeMessage("s2", busMessage(`${at}-a`, "s2", at));
		}
		const first = await store.peek("s2", { limit: 50 });
		// One page, from the front: what a poll reads, while the rest waits for the next page
		// instead of being skipped — a window taken from either end leaves mail behind it.
		expect(first.mail.map((entry) => entry.id)).toEqual(Array.from({ length: 50 }, (_, index) => `${1_000 + index}-a`));
		// Every id, not just the page's: the five it left out are still unread.
		expect(first.unread.size).toBe(55);
		expect(first.unread.has("1054-a")).toBe(true);
		// A caller that names what it has reads on past it.
		const known = new Set(first.mail.map((entry) => entry.id));
		expect((await store.peek("s2", { limit: 50, known })).mail.map((entry) => entry.id)).toEqual([
			"1050-a",
			"1051-a",
			"1052-a",
			"1053-a",
			"1054-a",
		]);
		// Consuming still starts at the front, so a limit never starves.
		expect((await store.inbox("s2", 1)).messages.map((entry) => entry.id)).toEqual(["1000-a"]);
		expect(await untoldOf(store.dir, "s2")).toBe(54);
	});

	test("orders the queue by when mail arrived, not by the clock the sender wrote it with", async () => {
		const { dir, store } = busStoreFixture(temps);
		// An id carries the sender's clock: a peer running ahead writes one that sorts after every
		// other, one running behind writes one that sorts before all of them. The queue is the
		// arrival, and a name only settles two files published in one filesystem tick.
		await store.writeMessage("s2", busMessage("9000-ahead", "s2", 9_000));
		await store.writeMessage("s2", busMessage("1000-behind", "s2", 1_000));
		await store.writeMessage("s2", busMessage("8000-tie", "s2", 8_000));
		await stampArrival(dir, "9000-ahead", 1_000);
		await stampArrival(dir, "8000-tie", 1_000);
		await stampArrival(dir, "1000-behind", 1_001);
		const page = (await store.peek("s2", { limit: 10 })).mail.map((entry) => entry.id);
		// The page is in the order it walked, which `at` would not give; consuming takes that front.
		expect(page).toEqual(["8000-tie", "9000-ahead", "1000-behind"]);
		expect((await store.inbox("s2", 1)).messages.map((entry) => entry.id)).toEqual(["8000-tie"]);
		expect((await store.inbox("s2", 10)).messages.map((entry) => entry.id)).toEqual(["9000-ahead", "1000-behind"]);
	});

	test("names a message it cannot parse and leaves it for the TTL", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.writeMessage("s2", busMessage("100-a", "s2"));
		const [inbox] = await readdir(join(dir, "inbox"));
		if (!inbox) throw new Error("the inbox directory was not written");
		const [file] = await readdir(join(dir, "inbox", inbox));
		if (!file) throw new Error("the message file was not written");
		await writeFile(join(dir, "inbox", inbox, file), "{");

		// Both reads name it: a board polling every second would otherwise pass it off as
		// empty inbox space, and the id it holds stays in the peek's set while its file is here.
		const peeked = { mail: [], unread: new Set(["100-a"]), unreadable: [file] };
		expect(await store.peek("s2", { limit: 10 })).toEqual(peeked);
		expect(await store.peek("s2", { limit: 10 })).toEqual(peeked);

		// Consuming does not destroy it: it may be mail a newer build can read, so the read
		// reports the name and leaves the file where it is.
		expect(await store.inbox("s2", 10)).toEqual({ messages: [], unreadable: [file] });
		expect(await readdir(join(dir, "inbox", inbox))).toEqual([file]);
		// The row's number is the mail its reader can open, so this file is named and not counted.
		expect(await untoldOf(store.dir, "s2")).toBe(0);

		// The TTL is what ends it, on the only clock a file with no readable `at` has.
		await store.pruneMail({ now: 1_700_000_000_000, messageTtlMs: 1e9, own: "s2" });
		expect(await readdir(join(dir, "inbox", inbox))).toEqual([file]);
	});

	test("names a refusal behind a full page once the mail in front of it is consumed", async () => {
		const { dir, store } = busStoreFixture(temps);
		for (const id of ["100-a", "101-b", "102-c"]) await store.writeMessage("s2", busMessage(id, "s2"));
		const [inbox] = await readdir(join(dir, "inbox"));
		if (!inbox) throw new Error("the inbox directory was not written");
		// The third message is the one this build cannot read, behind a page that holds two.
		const broken = "102-c.json";
		await writeFile(join(dir, "inbox", inbox, broken), "{");

		// The walk stops at the page, so the refusal is behind it and not yet named — the read
		// reports what it reached rather than reading the whole backlog to find one file.
		const first = await store.peek("s2", { limit: 2 });
		expect(first.mail.map((entry) => entry.id)).toEqual(["100-a", "101-b"]);
		expect(first.unreadable).toEqual([]);
		// The badge counts what a reader can open, so the file nothing can read is not in it.
		expect(await untoldOf(store.dir, "s2")).toBe(2);

		// Consuming the page puts it at the front, where the next read names it.
		await store.inbox("s2", 2);
		expect((await store.peek("s2", { limit: 2 })).unreadable).toEqual([broken]);
	});

	test("keeps an unparseable file inside the TTL and prunes it past it by its mtime", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.writeMessage("s2", busMessage("100-a", "s2"));
		const [inbox] = await readdir(join(dir, "inbox"));
		if (!inbox) throw new Error("the inbox directory was not written");
		const [file] = await readdir(join(dir, "inbox", inbox));
		if (!file) throw new Error("the message file was not written");
		const path = join(dir, "inbox", inbox, file);
		await writeFile(path, "{");

		// A fixed instant far ahead of the file it just wrote, so no case reads the wall clock.
		const ttl = 60_000;
		const now = 1_700_000_000_000;
		const at = (ms: number) => ({ now: ms, messageTtlMs: ttl, own: "s2" });

		await store.pruneMail(at(now));
		expect(await readdir(join(dir, "inbox", inbox))).toEqual([file]);

		// The file's own mtime is its age, and the only clock a message with no readable `at` has.
		const old = 1_700_000_000;
		await utimes(path, old, old);
		await store.pruneMail(at(old * 1000 + ttl + 1));
		expect(await readdir(join(dir, "inbox", inbox)).catch(() => [])).toEqual([]);
	});
	test("a publish that cannot land leaves what is there and takes its temp with it", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.ensure();
		// A directory where the record's file belongs: both renames are refused. The old path unlinked
		// the target before retrying, which is what made a second refusal cost the record. That half
		// needs a rename seam and is not reachable from here; what this holds is the two facts that
		// are — nothing at the path was touched, and no temp file was left behind.
		const name = `${storedName("s1")}.json`;
		await mkdir(join(dir, "sessions", name), { recursive: true });
		await expect(store.writeSession(sessionRecord("s1"))).rejects.toThrow();
		expect(await readdir(join(dir, "sessions"))).toEqual([name]);
	});
});

describe("claims", () => {
	test("is idempotent for the owner and conflicts for another", async () => {
		const { store } = busStoreFixture(temps);
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
		const { store } = busStoreFixture(temps);
		expect((await store.claimAll(["src/api"], "s1", "one", 100)).claimed).toEqual(["src/api"]);
		const blocked = await store.claimAll(["src/ui", "src/api"], "s2", "two", 101);
		expect(blocked.claimed).toEqual([]);
		expect(blocked.conflicts).toEqual([{ path: "src/api", owner: "s1", ownerLabel: "one" }]);
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/api"]);
	});

	test("names a blocker once per path, however many files it holds under it", async () => {
		const { store } = busStoreFixture(temps);
		await store.claimAll(["src/a.ts", "src/b.ts"], "s1", "one", 100);
		const blocked = await store.claimAll(["src"], "s2", "two", 101);
		expect(blocked.claimed).toEqual([]);
		// One owner on one requested path is one fact: the caller prints a sentence per conflict,
		// and a second copy of the same sentence is noise rather than a second blocker.
		expect(blocked.conflicts).toEqual([{ path: "src", owner: "s1", ownerLabel: "one" }]);
	});

	test("gives a batch that loses the create race nothing to hold", async () => {
		const { store } = busStoreFixture(temps);
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
		const { dir, store } = busStoreFixture(temps);
		// One path held before the call, one this batch would create, and one a rival takes
		// in the window between the pre-check and that batch's own create.
		expect((await store.claimAll(["src/api"], "s1", "one", 100)).claimed).toEqual(["src/api"]);
		const rival = createBusStore({ dir });
		const lost = await store.claimAll(["src/api", "src/ui", "src/web"], "s1", "one", 101, {
			afterClaim: async (path) => {
				if (path === "src/ui") await rival.claimAll(["src/web"], "s2", "two", 101);
			},
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

	test("settles a race on overlapping paths to one owner", async () => {
		const { dir, store } = busStoreFixture(temps);
		const rival = createBusStore({ dir });
		// The pre-check reads the claims once, so a batch still checking has published nothing and
		// nothing tells a rival to stop: the rival claims below `src` inside that window. Both publish,
		// and the settle step is what leaves one owner holding instead of two.
		let rivalResult: { claimed: string[]; conflicts: ClaimConflict[] } | undefined;
		const mine = await store.claimAll(["src"], "s-b", "bee", 100, {
			afterCheck: async () => {
				rivalResult = await rival.claimAll(["src/api"], "s-a", "ay", 100);
			},
		});
		// One keeper, whichever half of the rule decides it — the earlier file, or the smaller owner
		// when both land in one tick — and the loser names the winner.
		const held = (await store.claims()).map((claim) => claim.path);
		expect(held).toHaveLength(1);
		const loser = [{ claimed: mine.claimed, conflicts: mine.conflicts }, rivalResult].filter(
			(result) => result !== undefined && result.claimed.length === 0,
		);
		expect(loser).toHaveLength(1);
		expect(loser[0]?.conflicts[0]?.owner).toBe(held.includes("src") ? "s-b" : "s-a");
	});

	test("a settle loss gives back only what the batch created, not what the session already held", async () => {
		const { dir, store } = busStoreFixture(temps);
		const rival = createBusStore({ dir });
		// A path this session already holds, before any race — `reclaimHeld` on a resume is the
		// production call that looks like this.
		expect((await store.claimAll(["src/a.ts"], "s1", "one", 100)).claimed).toEqual(["src/a.ts"]);
		const lost = await store.claimAll(["src/a.ts", "lib/x"], "s1", "one", 101, {
			afterCheck: async () => {
				// The rival publishes `lib` after this batch's pre-check and before its first create, so
				// both pass: the settle decides that `lib/x` loses. `src/a.ts` was not this batch's, and a
				// session that gave it back would have lost a claim it legitimately held.
				await rival.claimAll(["lib"], "s2", "two", 101);
			},
		});
		expect(lost.claimed).toEqual([]);
		expect(lost.conflicts).toEqual([{ path: "lib/x", owner: "s2", ownerLabel: "two" }]);
		expect((await store.claims()).map((claim) => [claim.path, claim.owner])).toEqual([
			["lib", "s2"],
			["src/a.ts", "s1"],
		]);
	});

	test("moves a session's claims to another in one step, so a rival cannot win the gap (\#835)", async () => {
		const { store } = busStoreFixture(temps);
		await store.claimAll(["src/a.ts", "src/b.ts"], "s1", "jack", 100);
		const rival: string[][] = [];
		const { moved, notHeld } = await store.transfer(["src/a.ts", "src/b.ts", "lib"], "s1", "s2", "gavin", 200, {
			// The window a release-then-claim would open: a stranger reaches for the paths still to
			// move, after the first has already changed hands.
			afterMove: async () => {
				rival.push((await store.claimAll(["src/b.ts"], "s3", "tom", 150)).claimed);
			},
		});
		expect(moved).toEqual(["src/a.ts", "src/b.ts"]);
		// A path the first owner never held is not created by the move.
		expect(notHeld).toEqual(["lib"]);
		// One attempt per move — after the first path changed hands and after the second — and both
		// refused, which is the gap a release-then-claim would have left open.
		expect(rival).toEqual([[], []]);
		expect((await store.claims()).map((claim) => [claim.path, claim.owner, claim.ownerLabel])).toEqual([
			["src/a.ts", "s2", "gavin"],
			["src/b.ts", "s2", "gavin"],
		]);
		// And the peer it was taken from is told who holds them, rather than silently losing a race.
		expect((await store.claimAll(["src/b.ts"], "s1", "jack", 300)).conflicts).toEqual([
			{ path: "src/b.ts", owner: "s2", ownerLabel: "gavin" },
		]);
	});

	test("releases all claims owned by a session", async () => {
		const { store } = busStoreFixture(temps);
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		await store.claimAll(["src/b.ts"], "s2", "two", 100);
		expect(await store.releaseAll("s1")).toEqual(["src/a.ts"]);
		expect((await store.claims()).map((claim) => claim.path)).toEqual(["src/b.ts"]);
	});

	test("publishes a claim whole, so the loser of a race leaves no temp file", async () => {
		const { dir, store } = busStoreFixture(temps);
		expect((await store.claimAll(["src/a.ts"], "s1", "one", 100)).claimed).toEqual(["src/a.ts"]);
		expect((await store.claimAll(["src/a.ts"], "s2", "two", 101)).conflicts[0]?.owner).toBe("s1");
		expect(await store.claims()).toHaveLength(1);
		const names = await readdir(join(dir, "claims"));
		expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	test("republishes a claim whose file does not parse", async () => {
		const { dir, store } = busStoreFixture(temps);
		await store.claimAll(["src/a.ts"], "s1", "one", 100);
		const [file] = await readdir(join(dir, "claims"));
		if (!file) throw new Error("the claim file was not written");
		await writeFile(join(dir, "claims", file), "{");
		expect((await store.claimAll(["src/a.ts"], "s2", "two", 101)).claimed).toEqual(["src/a.ts"]);
		expect((await store.claims()).map((claim) => claim.owner)).toEqual(["s2"]);
	});
});
