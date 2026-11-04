/**
 * The `/sessions` board screen, and the row grammar the board and the `session`
 * tool's transcript block share.
 *
 * Peer-authored text reaches both surfaces, so the suite pins the shape a reader
 * sees and that a newline or an escape sequence in a label, a path, or a message
 * cannot forge a row or reach the terminal.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { busBoard, busClaim, busMessage, busSession, busStatus } from "../../../test/helpers/fixtures/session-bus.ts";
import { fakeTheme } from "../../../test/helpers/fakes.ts";
import { sessionDetailBlock, sessionRows, sessionRowLine, summaryCells } from "../rows.ts";
import { SessionListComponent } from "./session-list.ts";
import type { BoardSnapshot, BusMessage, SessionStatus } from "../types.ts";

/** The board read: a bus status plus this session's unread mail. */
function snapshot(statusValue: SessionStatus, messages: BusMessage[] = []): BoardSnapshot {
	return { status: statusValue, messages };
}

function expectBounded(lines: string[], width: number): void {
	for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
}

describe("session rows", () => {
	test("this session leads, peers follow by label, each with its claims", () => {
		const rows = sessionRows(busBoard());
		expect(rows.map((row) => row.session.label)).toEqual(["frontend", "backend", "verify-billing"]);
		expect(rows[0]?.self).toBe(true);
		expect(rows[1]?.claims.map((item) => item.path)).toEqual(["src/api", "src/api/routes.ts"]);
		expect(sessionRows(undefined)).toEqual([]);
	});

	test("draws the label, the you tag, and the counts in width", () => {
		const rows = sessionRows(busBoard());
		const self = rows[0];
		if (!self) throw new Error("no self row");
		const peer = rows[1];
		if (!peer) throw new Error("no peer row");
		const selfLine = sessionRowLine(self, fakeTheme, 80);
		expect(selfLine).toContain("frontend · you");
		expect(selfLine).toContain("0 unread");
		const peerLine = sessionRowLine(peer, fakeTheme, 80);
		expect(peerLine).toContain("3 unread");
		expect(peerLine).toContain("2 claims");
		expectBounded([sessionRowLine(self, fakeTheme, 40), sessionRowLine(peer, fakeTheme, 40)], 40);
	});

	test("neutralizes a peer label with an escape sequence or a newline", () => {
		const rows = sessionRows(busStatus([busSession({ id: "s1", label: "front\u001b[31m\nend" })]));
		const [row] = rows;
		if (!row) throw new Error("no row");
		const line = sessionRowLine(row, fakeTheme, 80);
		expect(line).not.toContain("\u001b");
		expect(line).not.toContain("\n");
	});

	test("summarizes sessions, unread, claims, and the watch", () => {
		const rows = sessionRows(busBoard());
		expect(summaryCells(fakeTheme, rows, undefined).join(" · ")).toContain("3 sessions");
		expect(summaryCells(fakeTheme, rows, undefined).join(" · ")).toContain("3 unread");
		expect(summaryCells(fakeTheme, rows, undefined).join(" · ")).toContain("2 claims");
		expect(summaryCells(fakeTheme, rows, { armed: true, wake: false }).join(" · ")).toContain("watch on");
		expect(summaryCells(fakeTheme, rows, { armed: true, wake: true }).join(" · ")).toContain("watch wake");
		const single = sessionRows(busStatus([busSession({ id: "s1", label: "solo" })]));
		expect(summaryCells(fakeTheme, single, undefined).join(" · ")).toBe("1 session · 0 claims");
	});

	test("a dead session is counted and rowed as gone, not as a quiet teammate", () => {
		const rows = sessionRows(
			busStatus([
				busSession({ id: "s1", label: "mine" }),
				busSession({ id: "s2", label: "crashed", unread: 0, state: "gone" }),
			]),
		);
		// The summary leads with it: a crash is the one cell a lead must not scan past.
		expect(summaryCells(fakeTheme, rows, undefined).join(" · ")).toContain("1 gone");
		const crashed = rows.find((row) => row.session.id === "s2");
		if (!crashed) throw new Error("no row");
		// The row's own counts would read "0 unread" for a session nothing can answer.
		const line = sessionRowLine(crashed, fakeTheme, 80);
		expect(line).toContain("gone");
		expect(line).not.toContain("0 unread");
		expect(sessionDetailBlock(crashed, 12_000).join("\n")).toContain("process gone");
	});

	test("the focus block names the cwd, at most two claims, and identity", () => {
		const rows = sessionRows(busBoard());
		const block = sessionDetailBlock(rows[1] as never, 12_000);
		expect(block[0]).toBe("cwd: /repo/frontend");
		expect(block[1]).toBe("claims: src/api, src/api/routes.ts");
		expect(block[2]).toContain("mode: tui");
		expect(block[2]).toContain("last seen: 2.0s ago");
		expect(block.join("\n")).not.toContain("3 unread");

		const many = busStatus(
			[busSession({ id: "s1" })],
			[
				busClaim({ path: "a", owner: "s1", ownerLabel: "solo" }),
				busClaim({ path: "b", owner: "s1", ownerLabel: "solo" }),
				busClaim({ path: "c", owner: "s1", ownerLabel: "solo" }),
			],
		);
		expect(sessionDetailBlock(sessionRows(many)[0] as never, 12_000)[1]).toBe("claims: a, b +1 more");
	});
});

describe("the /sessions screen", () => {
	interface Events {
		renders: number;
		closed: boolean;
		toggles: boolean[];
		releases: string[];
	}

	function events(): Events {
		return { renders: 0, closed: false, toggles: [], releases: [] };
	}

	function screen(initial: BoardSnapshot, recorded: Events): SessionListComponent {
		return new SessionListComponent({
			board: initial,
			theme: fakeTheme,
			callbacks: {
				toggleWatch: async (armed) => {
					recorded.toggles.push(armed);
					return armed ? "Inbox watch off." : "Inbox watch on.";
				},
				releaseClaim: async (path) => {
					recorded.releases.push(path);
					return `Released ${path}.`;
				},
			},
			onClose: () => {
				recorded.closed = true;
			},
			requestRender: () => {
				recorded.renders += 1;
			},
			now: () => 11_000,
		});
	}

	function ownClaimStatus(): SessionStatus {
		return busStatus(
			[busSession({ id: "abcdef123456", label: "frontend" })],
			[busClaim({ owner: "abcdef123456", ownerLabel: "frontend" })],
		);
	}

	test("draws the board with a summary, rows, a focus block, and the scope hints", () => {
		const view = screen(snapshot(busBoard()), events());
		view.handleInput("j");
		const lines = view.render(80);
		expect(lines[0]).toContain("Sessions");
		expect(lines.join("\n")).toContain("3 sessions");
		expect(lines.join("\n")).toContain("frontend · you");
		expect(lines.join("\n")).toContain("claims: src/api, src/api/routes.ts");
		expect(lines.join("\n")).toContain("w watch on");
		expect(lines.join("\n")).toContain("Tab inbox");
		expectBounded(lines, 80);
		expectBounded(view.render(40), 40);
	});

	test("Tab moves to the unread mail, and Enter opens it as prose", () => {
		const view = screen(snapshot(busBoard(), [busMessage()]), events());
		view.handleInput("\t");
		expect(view.currentScope).toBe("inbox");
		const list = view.render(80).join("\n");
		expect(list).toContain("Inbox");
		expect(list).toContain("is checkout.ts free?");
		expect(list).toContain("1 unread message");
		expect(list).toContain("Tab claims");

		view.handleInput("\r");
		expect(view.currentDetailId()).toBe("m:1-a");
		const pane = view.render(80).join("\n");
		expect(pane).toContain("backend · message");
		expect(pane).toContain("is checkout.ts free?");
		expect(pane).not.toContain("following");
		view.handleInput("\x1b");
		expect(view.currentDetailId()).toBeUndefined();
	});

	test("closes the mail pane when the message is consumed elsewhere", () => {
		const view = screen(snapshot(busBoard(), [busMessage()]), events());
		view.handleInput("\t");
		view.handleInput("\r");
		expect(view.currentDetailId()).toBe("m:1-a");
		view.setBoard(snapshot(busBoard(), []));
		const lines = view.render(80).join("\n");
		expect(lines).toContain("No unread mail.");
		expect(view.currentDetailId()).toBeUndefined();
	});

	test("Tab cycles to Claims, where a peer's claim is refused", () => {
		const recorded = events();
		const view = screen(snapshot(busBoard()), recorded);
		view.handleInput("\t");
		view.handleInput("\t");
		expect(view.currentScope).toBe("claims");
		const list = view.render(80).join("\n");
		expect(list).toContain("Claims");
		expect(list).toContain("2 claims");
		expect(list).toContain("x release");

		view.handleInput("x");
		expect(view.render(80).join("\n")).toContain("backend's claim; not released.");
		expect(recorded.releases).toEqual([]);
	});

	test("releases your own claim after a confirmation", async () => {
		const recorded = events();
		const view = screen(snapshot(ownClaimStatus()), recorded);
		view.handleInput("\t");
		view.handleInput("\t");
		view.handleInput("x");
		expect(view.render(80).join("\n")).toContain("Release src/api? y/N");
		view.handleInput("y");
		await Promise.resolve();
		await Promise.resolve();
		expect(recorded.releases).toEqual(["src/api"]);
		expect(view.render(80).join("\n")).toContain("Released src/api.");
	});

	test("releases from the open claim pane too", async () => {
		const recorded = events();
		const view = screen(snapshot(ownClaimStatus()), recorded);
		view.handleInput("\t");
		view.handleInput("\t");
		view.handleInput("\r");
		expect(view.currentDetailId()).toBe("c:src/api");
		view.handleInput("x");
		expect(view.render(80).join("\n")).toContain("Release src/api? y/N");
		view.handleInput("y");
		await Promise.resolve();
		await Promise.resolve();
		expect(recorded.releases).toEqual(["src/api"]);
	});

	test("opens a session pane with identity and claims, and returns on Esc", () => {
		const view = screen(snapshot(busBoard()), events());
		view.handleInput("j");
		view.handleInput("\r");
		expect(view.currentDetailId()).toBe("s:fedcba654321");
		const pane = view.render(80).join("\n");
		expect(pane).toContain("backend");
		expect(pane).toContain("/repo/frontend");
		expect(pane).toContain("src/api");
		expect(pane).toContain("last seen");
		expect(pane).not.toContain("following");
		view.handleInput("\x1b");
		expect(view.currentDetailId()).toBeUndefined();
	});

	test("closes the pane when the peer leaves the bus", () => {
		const view = screen(snapshot(busBoard()), events());
		view.handleInput("j");
		view.handleInput("\r");
		expect(view.currentDetailId()).toBe("s:fedcba654321");
		view.setBoard(snapshot(busStatus([busSession({ id: "abcdef123456", label: "frontend" })])));
		expect(view.render(80).join("\n")).toContain("Sessions");
		expect(view.currentDetailId()).toBeUndefined();
	});

	test("toggles the watch and shows the line it returns", async () => {
		const recorded = events();
		const view = screen(snapshot(busBoard()), recorded);
		view.handleInput("w");
		await Promise.resolve();
		expect(recorded.toggles).toEqual([false]);
		expect(view.render(80).join("\n")).toContain("Inbox watch on.");
	});

	test("closes on q and repaints only when the board changed", () => {
		const recorded = events();
		const view = screen(snapshot(busBoard()), recorded);
		view.setBoard(snapshot(busBoard()));
		expect(recorded.renders).toBe(0);
		view.setBoard(snapshot(busStatus([busSession({ id: "abcdef123456", label: "frontend", unread: 2 })])));
		expect(recorded.renders).toBe(1);
		view.setBoard(snapshot(busBoard(), [busMessage()]));
		expect(recorded.renders).toBe(2);
		view.handleInput("q");
		expect(recorded.closed).toBe(true);
	});

	test("names each scope's empty state, and says how to join", () => {
		const view = screen(snapshot(busStatus([])), events());
		expect(view.render(80).join("\n")).toContain("No sessions on this bus yet. Press w to join and listen.");
		view.handleInput("\t");
		expect(view.render(80).join("\n")).toContain("No unread mail.");
		view.handleInput("\t");
		expect(view.render(80).join("\n")).toContain("No claims.");
	});

	test("a reader that has not named itself says it is not on the bus", () => {
		const view = screen(snapshot({ ...busStatus([]), onBus: false }), events());
		expect(view.render(80).join("\n")).toContain("not on the bus");
	});

	test("keeps the scope key and the action in a narrow hint row", () => {
		const view = screen(snapshot(busBoard(), [busMessage()]), events());
		const sessions = view.render(46).join("\n");
		expect(sessions).toContain("Tab inbox");
		expect(sessions).toContain("w watch");
		view.handleInput("\t");
		expect(view.render(46).join("\n")).toContain("w watch");
		view.handleInput("\t");
		const claims = view.render(46).join("\n");
		expect(claims).toContain("Tab sessions");
		expect(claims).toContain("x release");
	});

	test("every scope fits the width", () => {
		const view = screen(snapshot(busBoard(), [busMessage()]), events());
		for (const width of [40, 80]) {
			for (const scope of [0, 1, 2]) {
				if (scope > 0) view.handleInput("\t");
				expectBounded(view.render(width), width);
			}
		}
	});
});
