import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { INBOX_DIR_NAME, storedName } from "./session-files.ts";
import {
	type BusMessage,
	isBusMessage,
	listArrivals,
	listMessages,
	pageOf,
	readMailLedger,
	type MailRecord,
	type WaitingPage,
	unaccountedMail,
	unaccountedOf,
	untoldIn,
	WAITING_LIMIT,
} from "./session-mail.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_700_000_000_000;

/** One message file in one inbox, landing at a stated mtime so the queue's order is stated too. */
function land(busDir: string, inbox: string, message: Partial<BusMessage> & { id: string }, mtime: number): void {
	const dir = join(busDir, INBOX_DIR_NAME, inbox);
	mkdirSync(dir, { recursive: true });
	const full: BusMessage = {
		from: "s-1",
		fromLabel: "team-lead",
		to: "s-2",
		toLabel: "billing-core",
		kind: "handoff",
		text: "take this card",
		at: mtime,
		...message,
	} as BusMessage;
	const path = join(dir, `${full.id}.json`);
	writeFileSync(path, `${JSON.stringify(full, null, 2)}\n`, "utf-8");
	utimesSync(path, mtime / 1000, mtime / 1000);
}

const busDir = (): string => scratchDir(temps, "pi-session-mail-");

/** The page a caller draws from one read of the bus: the projection every surface uses. */
const queuePage = async (dir: string, limit?: number): Promise<WaitingPage> =>
	pageOf(await readMailLedger(dir, []), limit);

describe("the waiting queue", () => {
	test("is empty where no bus has ever written, and where only records exist", async () => {
		const dir = busDir();
		expect((await queuePage(dir)).messages).toEqual([]);
		mkdirSync(join(dir, INBOX_DIR_NAME), { recursive: true });
		expect((await queuePage(dir)).messages).toEqual([]);
	});

	test("reads the front of the queue first, by when it landed", async () => {
		const dir = busDir();
		land(dir, "hash-a", { id: "m-2" }, NOW + 2_000);
		land(dir, "hash-a", { id: "m-1" }, NOW + 1_000);
		land(dir, "hash-b", { id: "m-3" }, NOW + 3_000);
		expect((await queuePage(dir)).messages.map((row) => row.id)).toEqual(["m-1", "m-2", "m-3"]);
	});

	test("orders by arrival, not by the sender's own clock", async () => {
		const dir = busDir();
		// A peer whose clock runs a day ahead stamps its message with 1970 and lands it last:
		// the queue is the inbox's clock, so it is read last.
		land(dir, "hash-a", { id: "m-ahead", at: NOW + 86_400_000 }, NOW + 1_000);
		land(dir, "hash-a", { id: "m-late-stamp", at: 1 }, NOW + 2_000);
		expect((await queuePage(dir)).messages.map((row) => row.id)).toEqual(["m-ahead", "m-late-stamp"]);
	});

	test("draws a broadcast once, naming every recipient it waits for", async () => {
		const dir = busDir();
		land(dir, "hash-a", { id: "m-all", kind: "event", to: "s-2", toLabel: "billing-core" }, NOW);
		land(dir, "hash-b", { id: "m-all", kind: "event", to: "s-3", toLabel: "ops-helper" }, NOW);
		land(dir, "hash-c", { id: "m-all", kind: "event", to: "s-4", toLabel: "team-lead" }, NOW);
		const page = await queuePage(dir);
		expect(page.messages).toHaveLength(1);
		expect(page.messages[0]?.to).toEqual([
			{ id: "s-2", label: "billing-core" },
			{ id: "s-3", label: "ops-helper" },
			{ id: "s-4", label: "team-lead" },
		]);
		expect(page.messages[0]?.kind).toBe("event");
	});

	test("folds a fan-out by recipient id, so a shared name stays two and one session stays one", async () => {
		const dir = busDir();
		// Two different sessions wear one label — the case a name cannot answer for.
		land(dir, "hash-a", { id: "m-shared", kind: "event", to: "s-2", toLabel: "billing-core" }, NOW);
		land(dir, "hash-b", { id: "m-shared", kind: "event", to: "s-3", toLabel: "billing-core" }, NOW);
		// One session's message reached two inboxes, which is one recipient twice over.
		land(dir, "hash-a", { id: "m-twice", kind: "event", to: "s-5", toLabel: "ops-helper" }, NOW + 1_000);
		land(dir, "hash-b", { id: "m-twice", kind: "event", to: "s-5", toLabel: "ops-helper" }, NOW + 1_000);
		const page = await queuePage(dir);
		expect(page.messages.map((row) => row.to)).toEqual([
			[
				{ id: "s-2", label: "billing-core" },
				{ id: "s-3", label: "billing-core" },
			],
			[{ id: "s-5", label: "ops-helper" }],
		]);
	});

	test("caps the page at the queue's own limit, oldest first", async () => {
		const dir = busDir();
		for (let index = 0; index < WAITING_LIMIT + 3; index++) {
			land(dir, "hash-a", { id: `m-${String(index).padStart(2, "0")}` }, NOW + index * 1_000);
		}
		const page = await queuePage(dir);
		expect(page.messages).toHaveLength(WAITING_LIMIT);
		expect(page.messages[0]?.id).toBe("m-00");
		// What the cap left out is counted, so a queue read to the bottom cannot look quiet.
		expect(page.dropped).toBe(3);
		// A caller decides its own cap; the default is only the page's.
		expect((await queuePage(dir, 2)).messages).toHaveLength(2);
		expect(await queuePage(dir, 0)).toEqual({ messages: [], dropped: WAITING_LIMIT + 3 });
	});

	test("skips a file that will not parse or is not a message, and keeps the queue behind it", async () => {
		const dir = busDir();
		const inbox = join(dir, INBOX_DIR_NAME, "hash-a");
		mkdirSync(inbox, { recursive: true });
		writeFileSync(join(inbox, "broken.json"), "{ not json\n", "utf-8");
		writeFileSync(join(inbox, "half.json"), JSON.stringify({ id: "m-half", from: "s-1" }), "utf-8");
		writeFileSync(join(inbox, "notes.txt"), "not mail\n", "utf-8");
		land(dir, "hash-a", { id: "m-1" }, NOW);
		expect((await queuePage(dir)).messages.map((row) => row.id)).toEqual(["m-1"]);
	});

	test("never consumes: every file is byte-identical after a read", async () => {
		const dir = busDir();
		land(dir, "hash-a", { id: "m-1" }, NOW);
		land(dir, "hash-b", { id: "m-all", kind: "event" }, NOW);
		const before = inboxSnapshot(dir);
		await queuePage(dir);
		await queuePage(dir, 1);
		expect(inboxSnapshot(dir)).toEqual(before);
	});

	test("carries the text whole, because a row shows a title and the hover says the rest", async () => {
		const dir = busDir();
		land(dir, "hash-a", { id: "m-1", text: "the gateway owner is on holiday; take the webhook drift card" }, NOW);
		expect((await queuePage(dir)).messages[0]?.text).toBe(
			"the gateway owner is on holiday; take the webhook drift card",
		);
	});
});

describe("the message guard", () => {
	test("accepts a message the bus wrote and refuses a file that only looks like one", () => {
		const message: BusMessage = {
			id: "m-1",
			from: "s-1",
			fromLabel: "team-lead",
			to: "s-2",
			toLabel: "billing-core",
			kind: "message",
			text: "hello",
			at: NOW,
		};
		expect(isBusMessage(message)).toBe(true);
		expect(isBusMessage({ ...message, paths: ["lib/a.ts"] })).toBe(true);
		// The envelope's two references are opaque ids: a string is one, anything else is not a message
		// this build can read.
		expect(isBusMessage({ ...message, replyTo: "a1b2c3", about: "4" })).toBe(true);
		expect(isBusMessage({ ...message, replyTo: 4 })).toBe(false);
		expect(isBusMessage({ ...message, about: ["4"] })).toBe(false);
		expect(isBusMessage({ ...message, to: undefined })).toBe(false);
		expect(isBusMessage({ ...message, paths: [1] })).toBe(false);
		expect(isBusMessage(null)).toBe(false);
	});
});

describe("the inbox's own order", () => {
	test("names the files oldest first, and answers nothing for a directory that is not there", async () => {
		const dir = busDir();
		land(dir, "hash-a", { id: "m-2" }, NOW + 2_000);
		land(dir, "hash-a", { id: "m-1" }, NOW + 1_000);
		expect(await listMessages(join(dir, INBOX_DIR_NAME, "hash-a"))).toEqual(["m-1.json", "m-2.json"]);
		expect(await listMessages(join(dir, INBOX_DIR_NAME, "nobody"))).toEqual([]);
	});

	test("hands out the arrival beside the name, as the file's own clock", async () => {
		const dir = busDir();
		land(dir, "hash-b", { id: "m-2" }, NOW + 2_000);
		land(dir, "hash-b", { id: "m-1" }, NOW + 1_000);
		const arrivals = await listArrivals(join(dir, INBOX_DIR_NAME, "hash-b"));
		// The stamp is the file's mtime rather than the sender's `at`, which is the whole reason the
		// queue is ordered by arrival: `waitingMail` draws that age, and it must not stat for it again.
		expect(arrivals.map((arrival) => arrival.name)).toEqual(["m-1.json", "m-2.json"]);
		expect(arrivals[0]?.at).toBe(statSync(join(dir, INBOX_DIR_NAME, "hash-b", "m-1.json")).mtimeMs);
		expect(await listArrivals(join(dir, INBOX_DIR_NAME, "nobody"))).toEqual([]);
	});
});

describe("the mail no record accounts for", () => {
	test("answers the message no record carries, and not the one it does", async () => {
		const dir = busDir();
		land(dir, storedName("s-live"), { id: "m-known", to: "s-live" }, NOW);
		land(dir, storedName("s-gone"), { id: "m-orphan", to: "s-gone", fromLabel: "gavin", kind: "ask" }, NOW + 1_000);
		// An inbox is named after the session it serves, and the roster counts mail by that record, so an
		// inbox no record names is mail with no row to hang a number on.
		const found = await unaccountedMail(dir, new Set(["s-live"]));
		expect(found.messages.map((entry) => entry.message.id)).toEqual(["m-orphan"]);
		expect(found.count).toBe(1);
		// The arrival travels with it: a message that sat for hours is the fact a reader judges by.
		expect(found.messages[0]?.at).toBe(
			statSync(join(dir, INBOX_DIR_NAME, storedName("s-gone"), "m-orphan.json")).mtimeMs,
		);
		expect(found.messages[0]?.message.toLabel).toBe("billing-core");
		expect(await unaccountedMail(dir, new Set(["s-live", "s-gone"]))).toEqual({ messages: [], count: 0 });
	});

	test("reads the inbox, not the field a message was written with", async () => {
		const dir = busDir();
		// The writer files a message under its recipient's name, so the two agree on a real bus. Where
		// they would not, the inbox decides: a record that still holds the directory can read what is
		// in it, so calling that mail ownerless would offer a person a drop of mail a session still has.
		land(dir, storedName("s-live"), { id: "m-misfiled", to: "s-gone" }, NOW);
		expect(await unaccountedMail(dir, new Set(["s-live"]))).toEqual({ messages: [], count: 0 });
	});

	test("answers a fan-out file by file, oldest first", async () => {
		const dir = busDir();
		land(dir, storedName("s-gone-2"), { id: "m-all", kind: "event", to: "s-gone-2", toLabel: "ben" }, NOW + 2_000);
		land(dir, storedName("s-gone-1"), { id: "m-all", kind: "event", to: "s-gone-1", toLabel: "amy" }, NOW + 1_000);
		// Two dead records are two files, which is what a drop has to name: the page draws the fan-out
		// as one row, and a listing that did the same could not be acted on.
		const found = await unaccountedMail(dir, new Set());
		expect(found.messages.map((entry) => entry.message.toLabel)).toEqual(["amy", "ben"]);
	});

	test("skips a file this build cannot parse, as the queue does", async () => {
		const dir = busDir();
		mkdirSync(join(dir, INBOX_DIR_NAME, storedName("s-broken")), { recursive: true });
		writeFileSync(join(dir, INBOX_DIR_NAME, storedName("s-broken"), "broken.json"), "{", "utf-8");
		land(dir, storedName("s-gone"), { id: "m-orphan", to: "s-gone" }, NOW);
		// A file with no readable `to` cannot be named or dropped, so the TTL stays its only end. It is
		// still counted: the page's number is the files nobody holds, which is what a drop addresses.
		const found = await unaccountedMail(dir, new Set());
		expect(found.messages.map((entry) => entry.message.id)).toEqual(["m-orphan"]);
		expect(found.count).toBe(2);
	});

	test("counts a file it cannot read and names only the ones it can", async () => {
		const dir = busDir();
		land(dir, storedName("s-gone"), { id: "m-orphan", to: "s-gone" }, NOW);
		mkdirSync(join(dir, INBOX_DIR_NAME, storedName("s-broken")), { recursive: true });
		writeFileSync(join(dir, INBOX_DIR_NAME, storedName("s-broken"), "broken.json"), "{", "utf-8");
		// A file no build can parse counts: it is a file nobody's record holds, and a drop addresses
		// it by the id in its name — while the page names only the ones it can read.
		const page = await unaccountedMail(dir, new Set());
		expect(page.count).toBe(2);
		expect(page.messages.map((entry) => entry.message.id)).toEqual(["m-orphan"]);
	});

	test("is empty where no bus has ever written", async () => {
		expect(await unaccountedMail(busDir(), new Set())).toEqual({ messages: [], count: 0 });
	});
});

/** Every file under the inboxes, with its bytes and its mtime: what a read must not change. */
function inboxSnapshot(dir: string): Record<string, string> {
	const out: Record<string, string> = {};
	const root = join(dir, INBOX_DIR_NAME);
	for (const inbox of readdirSync(root)) {
		for (const name of readdirSync(join(root, inbox)).sort()) {
			const path = join(root, inbox, name);
			out[`${inbox}/${name}`] = `${readFileSync(path, "utf-8")}@${String(statSync(path).mtimeMs)}`;
		}
	}
	return out;
}

/** A record the ledger can count against: the id, the name, and what it was told. */
const record = (id: string, told: string[] = []): MailRecord => ({ id, label: id, told });

describe("the mail ledger", () => {
	test("one pass answers a row's count and the queue it sits in", async () => {
		const dir = busDir();
		land(dir, storedName("s-1"), { id: "m-1", to: "s-1" }, NOW + 1_000);
		land(dir, storedName("s-1"), { id: "m-2", to: "s-1" }, NOW + 2_000);
		land(dir, storedName("s-1"), { id: "m-3", to: "s-1" }, NOW + 3_000);
		const ledger = await readMailLedger(dir, [record("s-1", ["m-1"])]);
		expect(untoldIn(ledger, "s-1")).toBe(2);
		expect(ledger.untold).toBe(2);
		// Told mail is not waiting to hear about it, but it is still in the inbox until consumed.
		expect(ledger.messages.map((message) => message.id)).toEqual(["m-1", "m-2", "m-3"]);
	});

	test("names a file it cannot read instead of counting it as a message", async () => {
		const dir = busDir();
		const inbox = join(dir, INBOX_DIR_NAME, storedName("s-1"));
		mkdirSync(inbox, { recursive: true });
		writeFileSync(join(inbox, "m-bad.json"), "{ not json");
		land(dir, storedName("s-1"), { id: "m-1", to: "s-1" }, NOW);
		const ledger = await readMailLedger(dir, [record("s-1")]);
		expect(ledger.inboxes[0]?.unreadable).toEqual(["m-bad.json"]);
		// Named, not counted: the row's number is the mail its reader can open, and this file is not
		// one — a card that counted it would promise mail no line explains.
		expect(untoldIn(ledger, "s-1")).toBe(1);
		expect(ledger.messages.map((message) => message.id)).toEqual(["m-1"]);
	});

	test("an inbox no record holds is unaccounted for, and not counted against anybody", async () => {
		const dir = busDir();
		land(dir, storedName("s-1"), { id: "m-1", to: "s-1" }, NOW);
		land(dir, storedName("s-gone"), { id: "m-2", to: "s-gone", toLabel: "gone-peer" }, NOW + 1_000);
		const ledger = await readMailLedger(dir, [record("s-1")]);
		expect(ledger.untold).toBe(1);
		const orphan = ledger.inboxes.find((inbox) => !inbox.held);
		expect(orphan?.id).toBe("s-gone");
		expect(orphan?.label).toBe("gone-peer");
		expect(unaccountedOf(ledger).count).toBe(1);
		expect(unaccountedOf(ledger).messages.map((row) => row.message.id)).toEqual(["m-2"]);
	});

	test("pages the queue it read, and says what the page left out", async () => {
		const dir = busDir();
		land(dir, storedName("s-1"), { id: "m-1", to: "s-1" }, NOW + 1_000);
		land(dir, storedName("s-1"), { id: "m-2", to: "s-1" }, NOW + 2_000);
		land(dir, storedName("s-1"), { id: "m-3", to: "s-1" }, NOW + 3_000);
		const page = pageOf(await readMailLedger(dir, [record("s-1")]), 2);
		expect(page.messages.map((message) => message.id)).toEqual(["m-1", "m-2"]);
		expect(page.dropped).toBe(1);
	});
});
