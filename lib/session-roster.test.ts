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
	readSessionLabel,
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
		writeSession(dir, "aaa", { id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW - 5_000 });
		writeMail(dir, "aaa", "1");
		writeMail(dir, "aaa", "2");
		writeSession(dir, "bbb", { id: "s-2", label: "billing-lead", mode: "print", lastSeen: NOW - 90_000 });
		const sessions = await readRoster(dir);
		expect(sessions).toEqual([
			{ id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW - 5_000, mail: 2 },
			{ id: "s-2", label: "billing-lead", mode: "print", lastSeen: NOW - 90_000, mail: 0 },
		]);
	});

	test("reads the process a record names, so the rule can tell who died", async () => {
		const dir = busDir();
		writeSession(dir, "aaa", {
			id: "s-1",
			label: "billing-core",
			mode: "tui",
			lastSeen: NOW,
			pid: 4242,
			startToken: "Mon Oct 26 00:02:00 2026",
		});
		// A record that names no process, or names one that is not a pid, is left without
		// the fields rather than being called dead on a malformed number.
		writeSession(dir, "bbb", { id: "s-2", label: "billing-lead", mode: "tui", lastSeen: NOW, pid: "4242" });
		const sessions = await readRoster(dir);
		expect(sessions?.[0]).toEqual({
			id: "s-1",
			label: "billing-core",
			mode: "tui",
			lastSeen: NOW,
			mail: 0,
			pid: 4242,
			startToken: "Mon Oct 26 00:02:00 2026",
		});
		expect(sessions?.[1]?.pid).toBeUndefined();
	});

	test("reads the listening field when it is there, and hides a malformed one", async () => {
		const dir = busDir();
		writeSession(dir, "aaa", {
			id: "s-1",
			label: "billing-core",
			mode: "tui",
			lastSeen: NOW,
			watching: { armed: true, wake: true },
		});
		writeSession(dir, "bbb", { id: "s-2", label: "billing-lead", mode: "tui", lastSeen: NOW, watching: "on" });
		const sessions = await readRoster(dir);
		expect(sessions?.[0]?.watching).toEqual({ armed: true, wake: true });
		// A malformed field costs the claim that mail will reach the peer, not the row.
		expect(sessions?.[1]).toEqual({ id: "s-2", label: "billing-lead", mode: "tui", lastSeen: NOW, mail: 0 });
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

describe("readSessionLabel", () => {
	test("finds this session's record under whichever key filed it", async () => {
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const ours = join(agentDir, BUS_DIR_NAME, "first");
		mkdirSync(join(ours, SESSIONS_DIR_NAME), { recursive: true });
		writeSession(ours, "aaa", { id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW });
		// A second repository's bus sits beside it: the id decides, not the directory.
		const other = join(agentDir, BUS_DIR_NAME, "second");
		mkdirSync(join(other, SESSIONS_DIR_NAME), { recursive: true });
		writeSession(other, "bbb", { id: "s-2", label: "billing-lead", mode: "tui", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1")).toBe("billing-core");
		expect(await readSessionLabel(agentDir, "s-2")).toBe("billing-lead");
	});

	test("answers undefined for a session no record names, and with no bus at all", async () => {
		const empty = temps.track(tempDir("pi-bus-agent-"));
		expect(await readSessionLabel(empty, "s-1")).toBeUndefined();
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const dir = join(agentDir, BUS_DIR_NAME, "key");
		mkdirSync(join(dir, SESSIONS_DIR_NAME), { recursive: true });
		writeSession(dir, "aaa", { id: "s-2", label: "billing-lead", mode: "tui", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1")).toBeUndefined();
	});

	test("skips a record that will not parse, and one that is not a record", async () => {
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const dir = join(agentDir, BUS_DIR_NAME, "key");
		mkdirSync(join(dir, SESSIONS_DIR_NAME), { recursive: true });
		writeFileSync(join(dir, SESSIONS_DIR_NAME, "broken.json"), "{ not json\n", "utf-8");
		writeSession(dir, "half", { id: "s-1", label: "half" });
		writeSession(dir, "good", { id: "s-1", label: "billing-core", mode: "tui", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1")).toBe("billing-core");
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

	test("a record with no pid is judged by its heartbeat alone, never called dead", () => {
		// A mode that is not a local process writes no pid; nothing may accuse it.
		const probe = () => expect.unreachable("no pid means nothing to probe");
		expect(rosterStateOf(session, NOW + SESSION_TTL_MS + 1, SESSION_TTL_MS, { alive: probe })).toBe("quiet");
	});

	test("a dead pid is gone, and a fresh heartbeat does not outrank it", () => {
		// The heartbeat was written seconds before the crash; the process is the newer fact.
		const dead = { ...session, pid: 4242 };
		expect(rosterStateOf(dead, NOW, SESSION_TTL_MS, { alive: () => false })).toBe("gone");
	});

	test("an alive pid with a fresh heartbeat is live, and the token is never asked for", () => {
		const token = () => expect.unreachable("a one-second poll must not spawn ps");
		const peer = { ...session, pid: 4242 };
		expect(rosterStateOf(peer, NOW, SESSION_TTL_MS, { alive: () => true, token })).toBe("live");
	});

	test("a stale heartbeat on the record's own process stays quiet", () => {
		const peer = { ...session, pid: 4242, startToken: "Mon Oct 26 00:02:00 2026" };
		const seams = { alive: () => true, token: () => "Mon Oct 26 00:02:00 2026" };
		expect(rosterStateOf(peer, NOW + SESSION_TTL_MS + 1, SESSION_TTL_MS, seams)).toBe("quiet");
	});

	test("a pid reused by another process is gone, not quiet", () => {
		// Same pid, another start time: the session that claimed it is gone.
		const peer = { ...session, pid: 4242, startToken: "Mon Oct 26 00:02:00 2026" };
		const seams = { alive: () => true, token: () => "Tue Oct 27 11:00:00 2026" };
		expect(rosterStateOf(peer, NOW + SESSION_TTL_MS + 1, SESSION_TTL_MS, seams)).toBe("gone");
	});

	test("a platform that cannot name a start time leaves a stale pid at quiet", () => {
		// Windows has no `ps`: the answer is ten minutes late, never wrong.
		const peer = { ...session, pid: 4242, startToken: "Mon Oct 26 00:02:00 2026" };
		const seams = { alive: () => true, token: () => undefined };
		expect(rosterStateOf(peer, NOW + SESSION_TTL_MS + 1, SESSION_TTL_MS, seams)).toBe("quiet");
	});
});
