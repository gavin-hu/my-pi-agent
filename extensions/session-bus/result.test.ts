/**
 * The `session` tool's transcript block: the collapsed line a reader sees without
 * expanding, the rows an expanded block draws, and the mail notice beside it.
 *
 * Peer-authored text reaches all three, so a case pins both the words a reader gets
 * and that a label, a path, or a body cannot forge a row, reach the terminal, or push
 * a line past the width it was drawn at.
 */

import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { busBoard, busMessage, busSession, busStatus } from "../../test/helpers/fixtures/session-bus.ts";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { TailResult } from "../../lib/tui/tool.ts";
import { mailNotice } from "./notice.ts";
import { collapsedLine, resultSections } from "./result.ts";
import { messageRowLine, messageRowLines } from "./rows.ts";

describe("the expanded result block", () => {
	test("status lists the sessions and heads the claims", () => {
		const input = resultSections({ action: "status", status: busBoard() });
		if (!input) throw new Error("no sections");
		const lines = new TailResult(input, fakeTheme).render(80);
		expect(lines[0]).toBe("");
		const text = lines.join("\n");
		expect(text).toContain("frontend · you");
		expect(text).toContain("Claims");
		expect(text).toContain("src/api");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(80);
		for (const line of new TailResult(input, fakeTheme).render(40)) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
	});

	test("inbox lists the messages with their sender", () => {
		const input = resultSections({
			action: "inbox",
			messages: [busMessage(), busMessage({ id: "2-b", kind: "event", text: "contract v2" })],
		});
		if (!input) throw new Error("no sections");
		const text = new TailResult(input, fakeTheme).render(80).join("\n");
		expect(text).toContain("is checkout.ts free?");
		expect(text).toContain("backend · event");
	});

	test("an inbox names the mail this build could not read", () => {
		const input = resultSections({
			action: "inbox",
			messages: [],
			unreadable: ["0001-verify-billing.json", "0002-newer-build.json"],
		});
		if (!input) throw new Error("no sections");
		const text = new TailResult(input, fakeTheme).render(80).join("\n");
		expect(text).toContain("Unreadable mail");
		expect(text).toContain("0001-verify-billing.json");
	});

	test("a send heads the peers it reached, then the ones it did not", () => {
		const input = resultSections({
			action: "send",
			delivered: ["backend"],
			failed: [{ label: "verify-billing", error: "inbox write failed" }],
		});
		if (!input) throw new Error("no sections");
		const text = new TailResult(input, fakeTheme).render(80).join("\n");
		expect(text).toContain("Delivered");
		expect(text).toContain("Not delivered");
		expect(text).toContain("inbox write failed");
	});

	test("release separates released paths from the ones it does not own", () => {
		const input = resultSections({ action: "release", released: ["src/ok.ts"], notOwned: ["src/theirs.ts"] });
		if (!input) throw new Error("no sections");
		const text = new TailResult(input, fakeTheme).render(80).join("\n");
		expect(text).toContain("Released");
		expect(text).toContain("Not yours");
		expect(text).toContain("src/theirs.ts");
	});

	test("an action with nothing to list has no rows", () => {
		const sections = resultSections({ action: "join", label: "backend", watching: { armed: true, wake: false } });
		expect(sections).toBeUndefined();
		expect(resultSections({ action: "inbox", messages: [] })).toBeUndefined();
		expect(resultSections({ action: "release", released: [], notOwned: [] })).toBeUndefined();
	});
});

describe("the collapsed result line", () => {
	test("status counts read in the plural and name the watch", () => {
		expect(collapsedLine(fakeTheme, { action: "status", status: busBoard() })).toBe("3 sessions · 3 unread · 2 claims");
		expect(
			collapsedLine(fakeTheme, {
				action: "status",
				status: { ...busBoard(), watching: { armed: true, wake: true } },
			}),
		).toContain("watch wake");
	});

	test("a gone session and a reader that has not joined are the board's own cells", () => {
		const gone = busStatus([
			busSession({ label: "frontend", id: "abcdef123456" }),
			busSession({ label: "verify-billing", id: "s2", mode: "rpc", state: "gone" }),
		]);
		const line = collapsedLine(fakeTheme, { action: "status", status: { ...gone, onBus: false } });
		expect(line).toContain("1 gone");
		expect(line).toContain("not on the bus");
		// What to do about it is the model-facing text's sentence; drawn here it wrapped the line.
		expect(line).not.toContain("session join");
	});

	test("an inbox names unreadable files instead of reading them as an empty inbox", () => {
		expect(collapsedLine(fakeTheme, { action: "inbox", messages: [], unreadable: ["0001-broken.json"] })).toBe(
			"1 unreadable file",
		);
		const mixed = collapsedLine(fakeTheme, {
			action: "inbox",
			messages: [busMessage()],
			unreadable: ["0001-broken.json", "0002-newer-build.json"],
		});
		expect(mixed).toContain("1 message");
		expect(mixed).toContain("2 unreadable files");
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

	test("the join line names the label and the state", () => {
		expect(
			collapsedLine(fakeTheme, { action: "join", label: "backend", watching: { armed: true, wake: true } }),
		).toContain("listening, wake");
		expect(
			collapsedLine(fakeTheme, { action: "join", label: "backend", watching: { armed: false, wake: false } }),
		).toContain("not listening");
	});

	test("a handoff is drawn as work, and a long body wraps instead of clipping", () => {
		const handoff = busMessage({
			kind: "handoff",
			text: `Handoff: #274 is yours, backend. Paths: extensions/session-bus. ${"It is already assigned to you — record the plan and start. ".repeat(2)}`,
		});
		const lines = messageRowLines(handoff, fakeTheme, 40);
		expect(lines[0]).toContain("backend · handoff");
		expect(lines[0]).not.toContain("Handoff: #274");
		// The instruction the wake exists for sits past where a clipped row stops.
		expect(lines.join(" ")).toContain("record the plan and start");
		for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40);
		expect(lines.length).toBeGreaterThan(2);
		// A body that fits keeps the one-line row it always had.
		expect(messageRowLines(busMessage(), fakeTheme, 80)).toHaveLength(1);
	});

	test("a message row is one neutralized line", () => {
		const line = messageRowLine(busMessage({ text: "back\u001b[31m\nend" }), fakeTheme, 80);
		expect(line).not.toContain("\u001b");
		expect(line).not.toContain("\n");
	});
});

describe("the mail notice", () => {
	test("keeps five model lines but hands every message to the renderer", () => {
		const messages = Array.from({ length: 6 }, (_, index) => busMessage({ id: `${index}`, text: `message ${index}` }));
		const notice = mailNotice(messages);
		expect(notice.content).toContain("6 new messages:");
		expect(notice.content).toContain("… 1 more");
		expect(notice.content.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(5);
		expect(notice.details.items).toHaveLength(6);
	});

	test("names a burst of handoffs as the work it is, and says to start it", () => {
		const notice = mailNotice([busMessage({ kind: "handoff", text: "Handoff: #4 is yours" })]);
		expect(notice.content).toContain("1 handoff");
		expect(notice.details.title).toBe("1 handoff");
		expect(notice.content).toContain("A handoff is work you now own");
		expect(notice.content).toContain("do not just acknowledge it");
	});

	test("keeps a handoff's instruction, which sits past a message's preview limit", () => {
		// The actionable line is last: paths and a note come first, so a 200-character
		// preview would cut exactly the part that makes the wake useful.
		const text = `Handoff: #4 "Billing webhook accepts orders" is yours, billing-core. Paths: ${"src/a".repeat(40)} It is already assigned to you — record the plan and start.`;
		const notice = mailNotice([busMessage({ kind: "handoff", text })]);
		expect(notice.content).toContain("already assigned to you");
		expect(notice.content.length).toBeLessThan(text.length + 400);
	});

	test("leaves a mixed burst as mail, and only the hint mentions the handoff", () => {
		const notice = mailNotice([busMessage({ kind: "handoff" }), busMessage({ kind: "event" })]);
		expect(notice.details.title).toBe("2 new messages");
		expect(notice.content).toContain("work you now own");
	});

	test("marks an event and neutralizes the sender", () => {
		const notice = mailNotice([busMessage({ fromLabel: "back\u001b[31mend", kind: "event" })]);
		expect(notice.details.items?.[0]?.severity).toBe("warn");
		expect(notice.details.items?.[0]?.label).not.toContain("\u001b");
		expect(notice.details.title).toBe("1 new message");
	});
});
