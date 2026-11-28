/**
 * What a record says, on every surface that draws it.
 *
 * The board's rows, the `session` tool's expanded block and the detail pane used to describe one
 * record three ways: the rows dropped the mark the text listing prints, the pane printed three
 * facts, and a claim-less session's pane read `Nothing to show.` beside a record with plenty to
 * say. These cases hold the one owner — `recordFacts` for the facts, `peerMark` for the mark — and
 * the sentence the whole card turns on: the mark a row prints is the mark `formatStatus` prints.
 *
 * A suite of its own because `view/session-list.test.ts` has to stay under the 400-line bar, and
 * these are about the record rather than about the screen's keys and panes.
 */

import { describe, expect, test } from "bun:test";
import { busClaim, busSession, busStatus } from "../../../test/helpers/fixtures/session-bus.ts";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import { formatStatus } from "../format.ts";
import { shortId } from "../protocol.ts";
import { markOf, recordFacts, sessionDetailBlock, sessionRows, sessionRowLine, watchWords } from "../rows.ts";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** The board read: this session joined, and one peer beside it. */
function board(peer: ReturnType<typeof busSession>) {
	return busStatus(
		[busSession(), peer],
		[busClaim({ path: "src/api", owner: peer.id, ownerLabel: peer.label })],
	);
}

/** The peer's row, which is the one every case here is about. */
function peerRow(peer: ReturnType<typeof busSession>) {
	const row = sessionRows(board(peer)).find((candidate) => !candidate.self);
	if (!row) throw new Error("the peer's row was not drawn");
	return row;
}

describe("the facts a record says", () => {
	test("names its state, its watch, both clocks, what it runs under, and what it holds", () => {
		const peer = busSession({
			label: "backend",
			id: "fedcba654321",
			unread: 3,
			startedAt: NOW - 2 * HOUR,
			lastSeen: NOW - 3 * MINUTE,
			watching: { armed: true, wake: false },
		});
		expect(recordFacts(peerRow(peer), NOW)).toEqual([
			{ label: "state", value: "live" },
			{ label: "watch", value: "watch on" },
			{ label: "up", value: "2h" },
			{ label: "last", value: "3m ago" },
			{ label: "mode", value: `tui · ${shortId("fedcba654321")}` },
			{ label: "mail", value: "3 unread · 1 claim" },
		]);
	});

	test("says a gone process in the state, and never loses the watch", () => {
		const peer = busSession({ label: "backend", id: "fedcba654321", state: "gone", unread: 2 });
		const facts = recordFacts(peerRow(peer), NOW);
		// One word for the state the row marks, and `process gone` stays: the pane is where a reader
		// finds out the process is dead and what to do about it.
		expect(facts[0]).toEqual({ label: "state", value: "gone · process gone" });
		// No `watching` on the record is a fact too — an older record, not a session that stopped
		// listening — and the two must not read the same.
		expect(facts[1]).toEqual({ label: "watch", value: "not recorded" });
	});

	test("reads the watch as the four things it can be", () => {
		expect(watchWords(undefined)).toBe("not recorded");
		expect(watchWords({ armed: false, wake: false })).toBe("not listening");
		expect(watchWords({ armed: true, wake: false })).toBe("watch on");
		expect(watchWords({ armed: true, wake: true })).toBe("watch wake");
	});
});

describe("the mark a record earns", () => {
	test("is the roster's, and the row and the text listing print the same one", () => {
		const cases = [
			{ name: "listening" as const, peer: busSession({ label: "backend", id: "fedcba654321" }) },
			{
				name: "not listening" as const,
				peer: busSession({ label: "backend", id: "fedcba654321", watching: { armed: false, wake: false } }),
			},
			{ name: "gone" as const, peer: busSession({ label: "backend", id: "fedcba654321", state: "gone", unread: 2 }) },
		];
		for (const { name, peer } of cases) {
			const row = peerRow(peer);
			const rowLine = sessionRowLine(row, fakeTheme, 80);
			const listing = formatStatus(board(peer), NOW)
				.split("\n")
				.filter((line) => line.includes("backend"))
				.join("\n");
			const mark = markOf(row.session);
			expect(mark, name).toBe(name === "listening" ? undefined : name);
			if (mark === undefined) {
				// Nothing to print: a healthy peer draws no mark on either surface.
				expect(rowLine, name).not.toContain("not listening");
				expect(listing, name).not.toContain("not listening");
				continue;
			}
			expect(rowLine, name).toContain(mark);
			expect(listing, name).toContain(mark);
		}
	});

	test("sits beside the unread count rather than replacing it", () => {
		const peer = busSession({ label: "backend", id: "fedcba654321", state: "gone", unread: 2 });
		const line = sessionRowLine(peerRow(peer), fakeTheme, 80);
		// The defect the card was opened for: `gone` used to stand where the count belongs, so a dead
		// peer's unread mail was invisible on the board.
		expect(line).toContain("gone");
		expect(line).toContain("2 unread");
		expect(line).toContain("1 claim");
	});
});

describe("the focus block", () => {
	test("is the cwd and the record's facts in one line", () => {
		const peer = busSession({
			label: "backend",
			id: "fedcba654321",
			unread: 3,
			startedAt: NOW - 2 * HOUR,
			lastSeen: NOW - 3 * MINUTE,
		});
		const block = sessionDetailBlock(peerRow(peer), NOW);
		expect(block[0]).toBe("cwd: /repo/frontend");
		expect(block[1]).toContain("state: live");
		expect(block[1]).toContain("last: 3m ago");
		expect(block[1]).toContain("mail: 3 unread · 1 claim");
		// The paths are the pane's: the row counts the claims and this line says how many, which is
		// what keeps the block a line shorter than the row it made room for.
		expect(block.join("\n")).not.toContain("src/api");
		expect(block).toHaveLength(2);
	});

	test("adds the door when the process is gone", () => {
		const peer = busSession({ label: "backend", id: "fedcba654321", state: "gone" });
		const block = sessionDetailBlock(peerRow(peer), NOW);
		expect(block[1]).toContain("state: gone · process gone");
		expect(block.at(-1)).toBe("forget: /sessions forget backend");
	});
});
