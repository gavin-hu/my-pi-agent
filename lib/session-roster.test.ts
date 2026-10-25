/**
 * The roster reader: what a teammate list needs from the bus, and what it must not
 * believe.
 *
 * Every case runs against a real directory laid out the way `session-bus` lays one
 * out, because the properties that matter — a missing directory answering `undefined`
 * while an empty one answers `[]`, a file that will not parse not taking the rest with
 * it — are properties of the filesystem. The directory is a temp dir under the OS
 * temp root, removed at teardown.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempTracker } from "../test/helpers/git.ts";
import { tempDir } from "../test/helpers/env.ts";
import {
	BUS_DIR_NAME,
	INBOX_DIR_NAME,
	SESSIONS_DIR_NAME,
	SESSION_TTL_MS,
	readRoster,
	rosterStateOf,
} from "./session-roster.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

const NOW = 1_000_000_000;

/** A bus directory in a temp root, with the file names the store hashes to. */
function busDir(): string {
	const dir = temps.track(tempDir("pi-bus-roster-"));
	mkdirSync(join(dir, SESSIONS_DIR_NAME), { recursive: true });
	return dir;
}

/** One session record, written under the name the store uses for it. */
function writeSession(dir: string, stem: string, record: Record<string, unknown>): void {
	writeFileSync(join(dir, SESSIONS_DIR_NAME, `${stem}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf-8");
}

/** One message file in a session's inbox. */
function writeMail(dir: string, stem: string, id: string): void {
	const inbox = join(dir, INBOX_DIR_NAME, stem);
	mkdirSync(inbox, { recursive: true });
	writeFileSync(join(inbox, `${id}.json`), "{}\n", "utf-8");
}

describe("readRoster", () => {
	test("answers undefined when the bus has never been used here", async () => {
		const missing = join(temps.track(tempDir("pi-bus-absent-")), BUS_DIR_NAME);
		expect(await readRoster(missing)).toBeUndefined();
	});

	test("answers an empty list when the bus exists but nobody joined", async () => {
		expect(await readRoster(busDir())).toEqual([]);
	});

	test("reads the fields a teammate row needs, and counts its mail", async () => {
		const dir = busDir();
		writeSession(dir, "aaa", { id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW - 5_000, pid: 7 });
		writeMail(dir, "aaa", "1");
		writeMail(dir, "aaa", "2");
		writeSession(dir, "bbb", { id: "s-2", label: "billing-lead", mode: "print", lastSeen: NOW - 90_000 });
		const sessions = await readRoster(dir);
		expect(sessions).toEqual([
			{ id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW - 5_000, mail: 2 },
			{ id: "s-2", label: "billing-lead", mode: "print", lastSeen: NOW - 90_000, mail: 0 },
		]);
	});

	test("orders by label, so a repaint does not reorder the list", async () => {
		const dir = busDir();
		writeSession(dir, "aaa", { id: "s-1", label: "web", mode: "tui", lastSeen: NOW });
		writeSession(dir, "bbb", { id: "s-2", label: "api", mode: "tui", lastSeen: NOW });
		expect((await readRoster(dir))?.map((session) => session.label)).toEqual(["api", "web"]);
	});

	test("skips a file that will not parse or is not a record, and keeps the rest", async () => {
		const dir = busDir();
		writeFileSync(join(dir, SESSIONS_DIR_NAME, "broken.json"), "{ not json\n", "utf-8");
		writeSession(dir, "half", { id: "s-half", label: "half" });
		writeFileSync(join(dir, SESSIONS_DIR_NAME, "notes.txt"), "not a record\n", "utf-8");
		writeSession(dir, "good", { id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW });
		expect(await readRoster(dir)).toEqual([{ id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 }]);
	});

	test("counts only message files, so a leftover directory entry is not mail", async () => {
		const dir = busDir();
		writeSession(dir, "aaa", { id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW });
		writeMail(dir, "aaa", "1");
		writeFileSync(join(dir, INBOX_DIR_NAME, "aaa", "README"), "x\n", "utf-8");
		expect((await readRoster(dir))?.[0]?.mail).toBe(1);
	});
});

describe("rosterStateOf", () => {
	const session = { id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW, mail: 0 };

	test("a heartbeat inside the TTL is live, and the boundary is inclusive", () => {
		expect(rosterStateOf(session, NOW)).toBe("live");
		expect(rosterStateOf(session, NOW + SESSION_TTL_MS)).toBe("live");
	});

	test("a heartbeat past the TTL is quiet, not gone", () => {
		// The record still exists: the bus prunes it later, so the page says "quiet".
		expect(rosterStateOf(session, NOW + SESSION_TTL_MS + 1)).toBe("quiet");
	});
});
