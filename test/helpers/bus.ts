/**
 * A session record on this repository's bus, written where `readRoster` reads it.
 *
 * Two board questions are answered by these files — what name this session writes as
 * (`BoardSession.who`), and whether the bus still holds it (`joinOnce`) — so a suite that
 * wants either has to leave the record a join leaves: the bus's directory, the bus's field
 * names, and a heartbeat its own clock judges. Two writers of that shape are how a suite
 * passes against a layout the bus no longer uses.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_DIR_NAME } from "../../lib/session-roster.ts";

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
}

/** Write one session record under `busDir`, and answer the file it wrote. */
export function writeBusRecord(busDir: string, record: BusRecord): string {
	const dir = join(busDir, SESSIONS_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${record.id}.json`);
	writeFileSync(file, JSON.stringify({ mode: "tui", ...record }), "utf-8");
	return file;
}

/** Remove a record, the way a stopped bus takes its own with it. */
export function removeBusRecord(file: string): void {
	rmSync(file, { force: true });
}
