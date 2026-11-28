/**
 * Another machine on the Team tab: its sessions, and the row that outlives them.
 *
 * A bus directory can be one a sync client replicates, so the Agents column draws rows whose
 * process is on another host. Two facts make that legible and neither is a class or a colour: a
 * session that is elsewhere says which machine, and a machine whose sessions have all been pruned
 * still has a row of its own saying when it was last here. Rendered, because "beside" and "last
 * seen" are claims about what a reader sees.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import type { ElementLike } from "../../../test/helpers/board-dom.ts";
import { LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import {
	BOARD_CHROME as CHROME,
	BOARD_PAINT_MS as PAINT_MS,
	type BoardBrowser,
	drawn,
	openBoardBrowser,
} from "../../../test/helpers/board-browser.ts";
import { makeClock } from "../../../test/helpers/clock.ts";
import { BUS_DIR_NAME, HOSTS_DIR_NAME, INBOX_DIR_NAME, SESSIONS_DIR_NAME } from "../../../lib/session-files.ts";

const HERE = "aaaaaaaaaaaaaaa1";
const STUDIO = "bbbbbbbbbbbbbbb2";
const HOUR = 60 * 60 * 1_000;

/** A bus directory holding one machine and one session on it, as a client would deliver them. */
function busWithStudio(now: number): string {
	const root = mkdtempSync(join(tmpdir(), "pi-board-bus-"));
	const bus = join(root, BUS_DIR_NAME);
	mkdirSync(join(bus, SESSIONS_DIR_NAME), { recursive: true });
	mkdirSync(join(bus, INBOX_DIR_NAME), { recursive: true });
	mkdirSync(join(bus, HOSTS_DIR_NAME), { recursive: true });
	// The other machine's session: its pid is a stranger here, so its heartbeat is the whole story.
	writeFileSync(
		join(bus, SESSIONS_DIR_NAME, "s-there.json"),
		JSON.stringify({
			id: "s-there",
			label: "billing-api",
			mode: "tui",
			// A record carries every field the one writer emits: since #994 the page's roster
			// requires what the bus requires, so a four-field session would not draw at all.
			pid: 0,
			cwd: "/repo",
			repoRoot: "/repo",
			startedAt: now - 600_000,
			lastSeen: now - 60_000,
			host: STUDIO,
			watching: { armed: true, wake: true },
		}),
	);
	writeFileSync(
		join(bus, HOSTS_DIR_NAME, `${STUDIO}.json`),
		JSON.stringify({ host: STUDIO, name: "studio", lastSeen: now - 3 * HOUR }),
	);
	return bus;
}

describe.skipIf(CHROME === undefined)("the Team tab's other machines", () => {
	const clock = makeClock(1_700_000_000_000);
	let board: BoardBrowser;
	let bus: string;

	beforeAll(async () => {
		bus = busWithStudio(clock.now());
		board = await openBoardBrowser({
			lead: LEAD.label,
			now: clock.now,
			seed: seedWorkingBoard,
			bus,
			host: HERE,
		});
	}, 120_000);

	afterAll(async () => {
		await board?.close();
	}, 120_000);

	/** The Agents column's rows, as the page drew them. */
	async function rows(page: Page): Promise<string[]> {
		return page.$$eval("#board-team .board-agent", (nodes) =>
			Array.from(nodes as ArrayLike<ElementLike>).map((node) => node.textContent ?? ""),
		);
	}

	test("says which machine a session is on, and draws that machine with its last-seen age", async () => {
		const page = await board.reuse();
		await page.click("#tab-team");
		await page.waitForSelector("#board-team .board-agent", { timeout: PAINT_MS });
		await drawn(page);
		const shown = await rows(page);
		// The session is elsewhere: its row says so, in a chip a reader can scan.
		expect(shown.some((text) => text.includes("billing-api") && text.includes("on studio"))).toBe(true);
		// The machine's own row: named, and how long ago it was here.
		const machine = shown.find((text) => text.includes("studio") && text.includes("last seen"));
		expect(machine).toBeDefined();
		expect(machine).toContain("another machine");
		// The age is the browser's own stamp, so the case holds that one is drawn rather than pinning
		// a value the wall clock decides; the wording is the row's.
		expect(machine).toMatch(/last seen \d/);
	});
});
