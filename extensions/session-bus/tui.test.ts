/**
 * The bus's terminal surfaces: the row grammar, the `/sessions` board, the
 * expanded transcript block, and the mail notice.
 *
 * Peer-authored text reaches every surface, so the suite pins both the shape a
 * reader sees and that a newline or an escape sequence in a label, a path, or a
 * message cannot forge a row or reach the terminal.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { mailNotice } from "./notice.ts";
import { messageRowLine, sessionDetailBlock, sessionRows, sessionRowLine, summaryCells } from "./rows.ts";
import { collapsedLine, resultSections, SessionResult } from "./result.ts";
import { SessionListComponent } from "./tui.ts";
import type { BoardSnapshot, BusMessage, ClaimRecord, SessionRecord, SessionStatus } from "./types.ts";

type ListedSession = SessionRecord & { unread: number };

function session(overrides: Partial<ListedSession> = {}): ListedSession {
	return {
		id: "abcdef123456",
		label: "frontend",
		pid: 1,
		cwd: "/repo/frontend",
		repoRoot: "/repo",
		mode: "tui",
		startedAt: 1_000,
		lastSeen: 10_000,
		unread: 0,
		...overrides,
	};
}

function claim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
	return { path: "src/api", owner: "fedcba654321", ownerLabel: "backend", at: 9_000, ...overrides };
}

function status(sessions: ListedSession[], claims: ClaimRecord[] = []): SessionStatus {
	return { me: { id: "abcdef123456", label: "frontend" }, onBus: true, sessions, claims };
}

function message(overrides: Partial<BusMessage> = {}): BusMessage {
	return {
		id: "1-a",
		from: "fedcba654321",
		fromLabel: "backend",
		to: "abcdef123456",
		toLabel: "frontend",
		kind: "message",
		text: "is checkout.ts free?",
		at: 9_500,
		...overrides,
	};
}

function board(): SessionStatus {
	return status(
		[
			session({ label: "verify-billing", id: "aaa111", mode: "rpc" }),
			session({ label: "backend", id: "fedcba654321", unread: 3 }),
			session({ label: "frontend", id: "abcdef123456" }),
		],
		[claim({ path: "src/api/routes.ts" }), claim({ path: "src/api" })],
	);
}

/** The board read: a bus status plus this session's unread mail. */
function snapshot(statusValue: SessionStatus, messages: BusMessage[] = []): BoardSnapshot {
	return { status: statusValue, messages };
}

function expectBounded(lines: string[], width: number): void {
	for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
}

describe("session rows", () => {
	test("this session leads, peers follow by label, each with its claims", () => {
		const rows = sessionRows(board());
		expect(rows.map((row) => row.session.label)).toEqual(["frontend", "backend", "verify-billing"]);
		expect(rows[0]?.self).toBe(true);
		expect(rows[1]?.claims.map((item) => item.path)).toEqual(["src/api", "src/api/routes.ts"]);
		expect(sessionRows(undefined)).toEqual([]);
	});

	test("draws the label, the you tag, and the counts in width", () => {
		const rows = sessionRows(board());
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
		const rows = sessionRows(status([session({ id: "s1", label: "front\u001b[31m\nend" })]));
		const [row] = rows;
		if (!row) throw new Error("no row");
		const line = sessionRowLine(row, fakeTheme, 80);
		expect(line).not.toContain("\u001b");
		expect(line).not.toContain("\n");
	});

	test("summarizes sessions, unread, claims, and the watch", () => {
		const rows = sessionRows(board());
		expect(summaryCells(fakeTheme, rows, undefined).join(" · ")).toContain("3 sessions");
		expect(summaryCells(fakeTheme, rows, undefined).join(" · ")).toContain("3 unread");
		expect(summaryCells(fakeTheme, rows, undefined).join(" · ")).toContain("2 claims");
		expect(summaryCells(fakeTheme, rows, { armed: true, wake: false }).join(" · ")).toContain("watch on");
		expect(summaryCells(fakeTheme, rows, { armed: true, wake: true }).join(" · ")).toContain("watch wake");
		const single = sessionRows(status([session({ id: "s1", label: "solo" })]));
		expect(summaryCells(fakeTheme, single, undefined).join(" · ")).toBe("1 session · 0 claims");
	});

	test("the focus block names the cwd, at most two claims, and identity", () => {
		const rows = sessionRows(board());
		const block = sessionDetailBlock(rows[1] as never, 12_000);
		expect(block[0]).toBe("cwd: /repo/frontend");
		expect(block[1]).toBe("claims: src/api, src/api/routes.ts");
		expect(block[2]).toContain("mode: tui");
		expect(block[2]).toContain("last seen: 2.0s ago");
		expect(block.join("\n")).not.toContain("3 unread");

		const many = status(
			[session({ id: "s1" })],
			[
				claim({ path: "a", owner: "s1", ownerLabel: "solo" }),
				claim({ path: "b", owner: "s1", ownerLabel: "solo" }),
				claim({ path: "c", owner: "s1", ownerLabel: "solo" }),
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
			latest: () => initial,
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
		return status(
			[session({ id: "abcdef123456", label: "frontend" })],
			[claim({ owner: "abcdef123456", ownerLabel: "frontend" })],
		);
	}

	test("draws the board with a summary, rows, a focus block, and the scope hints", () => {
		const view = screen(snapshot(board()), events());
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
		const view = screen(snapshot(board(), [message()]), events());
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
		const view = screen(snapshot(board(), [message()]), events());
		view.handleInput("\t");
		view.handleInput("\r");
		expect(view.currentDetailId()).toBe("m:1-a");
		view.setBoard(snapshot(board(), []));
		const lines = view.render(80).join("\n");
		expect(lines).toContain("No unread mail.");
		expect(view.currentDetailId()).toBeUndefined();
	});

	test("Tab cycles to Claims, where a peer's claim is refused", () => {
		const recorded = events();
		const view = screen(snapshot(board()), recorded);
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
		const view = screen(snapshot(board()), events());
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
		const view = screen(snapshot(board()), events());
		view.handleInput("j");
		view.handleInput("\r");
		expect(view.currentDetailId()).toBe("s:fedcba654321");
		view.setBoard(snapshot(status([session({ id: "abcdef123456", label: "frontend" })])));
		expect(view.render(80).join("\n")).toContain("Sessions");
		expect(view.currentDetailId()).toBeUndefined();
	});

	test("toggles the watch and shows the line it returns", async () => {
		const recorded = events();
		const view = screen(snapshot(board()), recorded);
		view.handleInput("w");
		await Promise.resolve();
		expect(recorded.toggles).toEqual([false]);
		expect(view.render(80).join("\n")).toContain("Inbox watch on.");
	});

	test("closes on q and repaints only when the board changed", () => {
		const recorded = events();
		const view = screen(snapshot(board()), recorded);
		view.setBoard(snapshot(board()));
		expect(recorded.renders).toBe(0);
		view.setBoard(snapshot(status([session({ id: "abcdef123456", label: "frontend", unread: 2 })])));
		expect(recorded.renders).toBe(1);
		view.setBoard(snapshot(board(), [message()]));
		expect(recorded.renders).toBe(2);
		view.handleInput("q");
		expect(recorded.closed).toBe(true);
	});

	test("names each scope's empty state, and says how to join", () => {
		const view = screen(snapshot(status([])), events());
		expect(view.render(80).join("\n")).toContain("No sessions on this bus. Name this session to join.");
		view.handleInput("\t");
		expect(view.render(80).join("\n")).toContain("No unread mail.");
		view.handleInput("\t");
		expect(view.render(80).join("\n")).toContain("No claims.");
	});

	test("a reader that has not named itself says it is not on the bus", () => {
		const view = screen(snapshot({ ...status([]), onBus: false }), events());
		expect(view.render(80).join("\n")).toContain("not on the bus");
	});

	test("keeps the scope key and the action in a narrow hint row", () => {
		const view = screen(snapshot(board(), [message()]), events());
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
		const view = screen(snapshot(board(), [message()]), events());
		for (const width of [40, 80]) {
			for (const scope of [0, 1, 2]) {
				if (scope > 0) view.handleInput("\t");
				expectBounded(view.render(width), width);
			}
		}
	});
});

describe("the expanded result block", () => {
	test("status lists the sessions and heads the claims", () => {
		const input = resultSections({ action: "status", status: board() });
		if (!input) throw new Error("no sections");
		const lines = new SessionResult(input, fakeTheme).render(80);
		expect(lines[0]).toBe("");
		const text = lines.join("\n");
		expect(text).toContain("frontend · you");
		expect(text).toContain("Claims");
		expect(text).toContain("src/api");
		expectBounded(lines, 80);
		expectBounded(new SessionResult(input, fakeTheme).render(40), 40);
	});

	test("inbox lists the messages with their sender", () => {
		const input = resultSections({
			action: "inbox",
			messages: [message(), message({ id: "2-b", kind: "event", text: "contract v2" })],
		});
		if (!input) throw new Error("no sections");
		const text = new SessionResult(input, fakeTheme).render(80).join("\n");
		expect(text).toContain("is checkout.ts free?");
		expect(text).toContain("backend · event");
	});

	test("release separates released paths from the ones it does not own", () => {
		const input = resultSections({ action: "release", released: ["src/ok.ts"], notOwned: ["src/theirs.ts"] });
		if (!input) throw new Error("no sections");
		const text = new SessionResult(input, fakeTheme).render(80).join("\n");
		expect(text).toContain("Released");
		expect(text).toContain("Not yours");
		expect(text).toContain("src/theirs.ts");
	});

	test("an action with nothing to list has no rows", () => {
		expect(resultSections({ action: "watch", watching: { armed: true, wake: false } })).toBeUndefined();
		expect(resultSections({ action: "inbox", messages: [] })).toBeUndefined();
		expect(resultSections({ action: "release", released: [], notOwned: [] })).toBeUndefined();
	});
});

describe("the collapsed result line", () => {
	test("status counts read in the plural and name the watch", () => {
		expect(collapsedLine(fakeTheme, { action: "status", status: board() })).toBe("3 sessions · 3 unread · 2 claims");
		expect(
			collapsedLine(fakeTheme, {
				action: "status",
				status: { ...board(), watching: { armed: true, wake: true } },
			}),
		).toContain("watch wake");
	});

	test("a claim conflict names the path and its owner", () => {
		const line = collapsedLine(fakeTheme, {
			action: "claim",
			claimed: [],
			conflicts: [{ path: "src/api", owner: "fedcba654321", ownerLabel: "backend" }],
		});
		expect(line).toContain("1 conflict");
		expect(line).toContain("src/api held by backend");
	});

	test("a release names the paths it did not own", () => {
		const line = collapsedLine(fakeTheme, { action: "release", released: [], notOwned: ["src/theirs.ts"] });
		expect(line).toContain("Not yours: src/theirs.ts");
	});

	test("empty results never print a bare success", () => {
		expect(collapsedLine(fakeTheme, { action: "send", delivered: [] })).toBe("Delivered to nobody");
		expect(collapsedLine(fakeTheme, { action: "claim", claimed: [], conflicts: [] })).toBe("Claimed nothing");
		expect(collapsedLine(fakeTheme, { action: "inbox", messages: [] })).toBe("Inbox empty");
		expect(collapsedLine(fakeTheme, { action: "release", released: [], notOwned: [] })).toBe("Nothing to release");
	});

	test("the watch line says which mode is on", () => {
		expect(collapsedLine(fakeTheme, { action: "watch", watching: { armed: true, wake: true } })).toContain(
			"wakes a turn",
		);
		expect(collapsedLine(fakeTheme, { action: "watch", watching: { armed: false, wake: false } })).toBe(
			"Inbox watch off",
		);
	});

	test("a message row is one neutralized line", () => {
		const line = messageRowLine(message({ text: "back\u001b[31m\nend" }), fakeTheme, 80);
		expect(line).not.toContain("\u001b");
		expect(line).not.toContain("\n");
	});
});

describe("the mail notice", () => {
	test("keeps five model lines but hands every message to the renderer", () => {
		const messages = Array.from({ length: 6 }, (_, index) => message({ id: `${index}`, text: `message ${index}` }));
		const notice = mailNotice(messages);
		expect(notice.content).toContain("6 new messages:");
		expect(notice.content).toContain("… 1 more");
		expect(notice.content.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
		expect(notice.details.items).toHaveLength(6);
	});

	test("marks an event and neutralizes the sender", () => {
		const notice = mailNotice([message({ fromLabel: "back\u001b[31mend", kind: "event" })]);
		expect(notice.details.items?.[0]?.severity).toBe("warn");
		expect(notice.details.items?.[0]?.label).not.toContain("\u001b");
		expect(notice.details.title).toBe("1 new message");
	});
});
