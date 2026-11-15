/**
 * What the Team tab's two mail numbers count, over a real bus.
 *
 * The Agents column counts one thing per card and the Waiting pane counts another, and both are
 * printed as "mail" — so a case here drives the shipped page over mail files rather than over the
 * rows a stub hands it. A stub cannot disagree with itself: only the files can show a card saying
 * two while the queue draws one, or a queue naming a recipient the card does not count.
 *
 * The seats: the bus's records name the page's lead, so the column's first card is the page.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { makeClock } from "../../../test/helpers/clock.ts";
import { CORE, LEAD, seedWorkingBoard } from "../../../test/helpers/board-fixture.ts";
import { landMessage, writeBusRecord } from "../../../test/helpers/bus.ts";
import { BOARD_CHROME as CHROME, type BoardBrowser, openBoardBrowser } from "../../../test/helpers/board-browser.ts";
import type { BusMessage } from "../../../lib/session-mail.ts";
import { storedName } from "../../../lib/session-files.ts";

/** A fixed clock: the queue is ordered by arrival, and a wall clock would reorder it. */
const clock = makeClock(1_760_000_000_000);

/** How long a case that boots a page over a real bus may take. */
const CASE_MS = 30_000;

const PEER = { id: "s-peer", label: "billing-peer" } as const;

/** The id a session is filed under on the bus; `Actor.id` is optional only for the person. */
const idOf = (actor: { id?: string; label: string }): string => actor.id ?? actor.label;

/** The session the file names a recipient for, when the file and the inbox disagree. */
const message = (fields: Partial<BusMessage> & { id: string; to: string; toLabel: string }): BusMessage => ({
	...fields,
	from: fields.from ?? idOf(LEAD),
	fromLabel: fields.fromLabel ?? LEAD.label,
	kind: fields.kind ?? "message",
	text: fields.text ?? "hello",
	at: fields.at ?? clock.now() - 60_000,
});

/** The running total on a card's mail chip, or 0 when the card carries none. */
async function cardMail(page: Page, label: string): Promise<number> {
	const text = await page.textContent(
		`#board-team .board-agent:has(.board-agent__name:text-is("${label}")) .board-agent__mail`,
	);
	const counted = /^(\d+)/.exec(text ?? "");
	return counted === null ? 0 : Number(counted[1]);
}

/** The number in one column's or pane's caption, as the page paints it. */
async function headCount(page: Page, selector: string): Promise<string> {
	return (await page.textContent(`${selector} .bf-section__count`)) ?? "";
}

/** The recipients the Waiting pane names, in the order it draws them. */
async function waitingTo(page: Page): Promise<string[]> {
	return page.$$eval("#board-team [data-pane=waiting] .board-mail__to", (nodes) =>
		Array.from(nodes as ArrayLike<{ textContent: string | null }>, (node) => node.textContent ?? ""),
	);
}

let board: BoardBrowser;
let bus = "";

describe.skipIf(CHROME === undefined)("the Team tab's mail, over a real bus", () => {
	beforeAll(async () => {
		bus = mkdtempSync(join(tmpdir(), "pi-board-mail-"));
		const now = clock.now();
		writeBusRecord(bus, { id: idOf(LEAD), label: LEAD.label, lastSeen: now });
		writeBusRecord(bus, { id: idOf(CORE), label: CORE.label, lastSeen: now });
		writeBusRecord(bus, { id: PEER.id, label: PEER.label, lastSeen: now });
		// One broadcast to all three — one file per inbox, one id — and one handoff to one session.
		for (const session of [LEAD, CORE, PEER]) {
			await landMessage(
				bus,
				message({
					id: "m-bcast",
					to: idOf(session),
					toLabel: session.label,
					kind: "event",
					text: "the gateway is back",
				}),
				now - 60_000,
			);
		}
		await landMessage(
			bus,
			message({ id: "m-hand", to: idOf(CORE), toLabel: CORE.label, kind: "handoff" }),
			now - 30_000,
		);
		board = await openBoardBrowser({ lead: LEAD.label, now: clock.now, seed: seedWorkingBoard, bus });
	}, CASE_MS);

	afterAll(async () => {
		await board?.close();
		rmSync(bus, { recursive: true, force: true });
	}, CASE_MS);

	test(
		"puts every waiting message on its recipient's card and draws it once in the queue",
		async () => {
			const page = await board.reuse();
			// Each card counts what waits for it: the broadcast copy plus, for the handoff's recipient, one more.
			expect(await cardMail(page, LEAD.label)).toBe(1);
			expect(await cardMail(page, CORE.label)).toBe(2);
			expect(await cardMail(page, PEER.label)).toBe(1);
			// The queue is one row per message, so the broadcast is drawn once and names its three readers.
			expect(await headCount(page, "#board-team [data-pane=waiting] .bf-section__cap")).toBe("2");
			expect(await waitingTo(page)).toEqual(["all (3)", CORE.label]);
		},
		CASE_MS,
	);

	test(
		"counts only the mail the queue can read",
		async () => {
			// A file this build cannot read is mail for a newer build: `session inbox` names it rather
			// than deleting it, and the queue skips it. A card that counted it would promise its reader
			// mail that no row explains and no read clears.
			writeFileSync(
				join(bus, "inbox", storedName(PEER.id), "1799999999999-unreadable.json"),
				"{ this is not a message",
			);
			const page = await board.reuse();
			expect(await cardMail(page, PEER.label)).toBe(1);
		},
		CASE_MS,
	);

	test(
		"names the inbox's owner rather than the label the file carries",
		async () => {
			// An inbox belongs to one session id, and the roster counts its files for that session; a
			// queue that believed the file's own `toLabel` would name somebody the card does not count,
			// so one message would read as waiting for a session that is holding nothing.
			await landMessage(bus, message({ id: "m-drift", to: idOf(CORE), toLabel: PEER.label }), clock.now() - 10_000);
			const page = await board.reuse();
			expect(await waitingTo(page)).toContain(CORE.label);
			expect(await waitingTo(page)).not.toContain(PEER.label);
		},
		CASE_MS,
	);
});
