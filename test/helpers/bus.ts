/**
 * A session record on this repository's bus, written where `readRoster` reads it.
 *
 * Every session writes its own record, every message is its own file, and the fields are
 * the bus's own: two board questions are answered by these files — what name this session
 * writes as (`BoardSession.who`) and whether the bus still holds it (`joinTeam`) — so a
 * suite that wants either has to leave the record a join leaves: the bus's directory, the
 * bus's field names, and a heartbeat its own clock judges. Two writers of that shape are
 * how a suite passes against a layout the bus no longer uses. The blocked inbox is here for
 * the same reason: it is a path the store computes, and a suite that spelled it itself
 * would be the second statement of where mail lives.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { createBusStore } from "../../extensions/session-bus/store.ts";
import type { BusMessage, SessionRecord } from "../../extensions/session-bus/types.ts";
import { readMailLedger, untoldIn } from "../../lib/session-mail.ts";
import { INBOX_DIR_NAME, SESSIONS_DIR_NAME, storedName } from "../../lib/session-files.ts";
import { tempDir } from "./env.ts";
import type { TempTracker } from "./git.ts";

/** The fields a suite varies; everything else in the file is the bus's own shape. */
export interface BusRecord {
	id: string;
	label: string;
	/** When the session last proved it was alive, on the suite's clock. */
	lastSeen: number;
	/** The process that owns the record, when the case is about one that is gone. */
	pid?: number;
	/** Whether the session listens for mail, as a join writes it. */
	watching?: { armed: boolean; wake: boolean };
	/** The machine that wrote the record, for a case about a bus this machine did not write. */
	host?: string;
}

/** The fields every writer emits, for a fixture that only cares about a few of them. */
// `pid: 0` is a record that names no process: the guard requires a number and `pidOf` drops a
// non-positive one, so a fixture reads like the record an older build wrote instead of claiming
// this test process is the session — which would make every case's row look like its own.
const DEFAULTS = { mode: "tui", pid: 0, cwd: "", repoRoot: "", startedAt: 50, lastSeen: 100 };

/**
 * Write one session record under `busDir`, and answer the file it wrote.
 *
 * The fields every writer emits are filled in unless a case names them: since #994 both readers
 * require what `SessionRecord` requires, so a fixture missing `pid` would describe a file no
 * writer can produce and would test a refusal rather than the thing it is about.
 */
export function writeBusRecord(busDir: string, record: BusRecord): string {
	const dir = join(busDir, SESSIONS_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${record.id}.json`);
	const full = { ...DEFAULTS, cwd: busDir, repoRoot: busDir, ...record };
	writeFileSync(file, JSON.stringify(full), "utf-8");
	return file;
}

/**
 * The record a join leaves: the session, and the watch a team door asks for — armed, and waking.
 *
 * The bus writes the two together (`join` stores the record and its watch in one file), so a suite
 * that wants the state after a join must not write the half that says nothing about mail: a record
 * with no watch is a session nothing has joined yet, which the next door asks again for.
 */
export function writeJoinedRecord(busDir: string, record: Omit<BusRecord, "pid" | "watching">): string {
	return writeBusRecord(busDir, { ...record, watching: { armed: true, wake: true } });
}

/** Remove a record, the way a stopped bus takes its own with it. */
export function removeBusRecord(file: string): void {
	rmSync(file, { force: true });
}

/**
 * Make one session's inbox unwritable by putting a file where its directory goes.
 *
 * Staged on disk rather than through a seam, because that is the shape a real failure
 * takes: `mkdir` refuses the path on every platform. The name is the bus's own, so the
 * case blocks the very inbox `send` will write.
 */
export function blockInbox(busDir: string, id: string): void {
	mkdirSync(join(busDir, INBOX_DIR_NAME), { recursive: true });
	writeFileSync(join(busDir, INBOX_DIR_NAME, storedName(id)), "");
}

/** A store over a temp bus directory the suite cleans up, for the cases that write through it. */
export function busStoreFixture(temps: TempTracker): { dir: string; store: ReturnType<typeof createBusStore> } {
	const dir = temps.track(tempDir("pi-session-bus-"));
	return { dir, store: createBusStore({ dir }) };
}

/** One record as the bus writes it, with the fields a prune case varies. */
export const sessionRecord = (id: string, lastSeen = 100): SessionRecord => ({
	id,
	label: id,
	pid: 1,
	cwd: "/repo",
	repoRoot: "/repo",
	mode: "tui",
	startedAt: 50,
	lastSeen,
});

/** One message file's contents, written under `to`'s inbox. */
export const busMessage = (id: string, to: string, at = 100): BusMessage => ({
	id,
	from: "s1",
	fromLabel: "one",
	to,
	toLabel: "two",
	kind: "message",
	text: "hello",
	at,
});

/**
 * One message landed in its recipient's inbox, arriving at `at`.
 *
 * Written through the store's own writer — the file name is the message id, the directory is
 * `storedName(recipient)` — so a case about what a reader of the bus counts is counting files
 * the bus would have written. The arrival is stamped afterwards because the queue is ordered by
 * mtime rather than by the sender's `at`, which is the one part of the layout a send cannot fix.
 */
export async function landMessage(busDir: string, message: BusMessage, at: number): Promise<void> {
	const store = createBusStore({ dir: busDir });
	await store.writeMessage(message.to, message);
	await utimes(join(busDir, INBOX_DIR_NAME, storedName(message.to), `${message.id}.json`), at / 1000, at / 1000);
}

/** Name a message file's arrival instead of racing the wall clock: the seam the TTL cases use. */
export async function stampArrival(dir: string, id: string, at: number): Promise<void> {
	const [inbox] = await readdir(join(dir, "inbox"));
	if (!inbox) throw new Error("the inbox directory was not written");
	await utimes(join(dir, "inbox", inbox, `${id}.json`), at, at);
}

/**
 * The mail one id's inbox holds that the record was not told about.
 *
 * The ledger is the one counter now, so a suite asks it rather than the store: a case that
 * counted its own way would keep passing after a surface stopped agreeing with the queue.
 */
export async function untoldOf(busDir: string, id: string, told: readonly string[] = []): Promise<number> {
	return untoldIn(await readMailLedger(busDir, [{ id, label: id, told }]), id);
}
