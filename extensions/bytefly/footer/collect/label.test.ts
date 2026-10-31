/**
 * The session's name on the bar: the roster label when the bus has one.
 *
 * Two facts meet here and only one of them is Pi's — a session name the terminal knows, and
 * a label a peer addresses. So the cases are: what the follower reports (this session's
 * record, this session's event, not a peer's), that the snapshot carries it, and what the
 * segment draws when both, one, or neither exist.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUS_DIR_NAME, SESSIONS_DIR_NAME } from "../../../../lib/session-roster.ts";
import { SESSION_LABEL_CHANNEL } from "../../../../lib/session-label.ts";
import { scratchDir, withAgentDir } from "../../../../test/helpers/env.ts";
import { emit, fakeTheme, makeFakePi } from "../../../../test/helpers/fakes.ts";
import { fakeFooterCtx, fullSnapshot, renderFooter } from "../../../../test/helpers/fixtures/footer.ts";
import { makeTempTracker } from "../../../../test/helpers/git.ts";
import { waitFor } from "../../../../test/helpers/process.ts";
import { followRosterLabel } from "./label.ts";
import { createSnapshotReader } from "./snapshot.ts";
import { createDelegationLedger } from "../delegation.ts";
import { DEFAULT_BYTEFLY_CONFIG } from "../price/config.ts";
import { registerFooter } from "../register.ts";
import { sessionSegment } from "../render/segments.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** An agent directory holding one repository's bus, with one record in it. */
function busWith(id: string, label: string): { agentDir: string; record: string } {
	const agentDir = temps.track(scratchDir(temps, "pi-footer-label-"));
	const dir = join(agentDir, BUS_DIR_NAME, "key", SESSIONS_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	const record = join(dir, "record.json");
	writeFileSync(record, JSON.stringify({ id, label, mode: "tui", lastSeen: 1_000 }), "utf-8");
	return { agentDir, record };
}

/** Follow a session's label, and collect everything the follower reports. */
async function follow(
	agentDir: string,
): Promise<{ pi: ReturnType<typeof makeFakePi>["pi"]; reports: Array<string | null> }> {
	const { pi } = makeFakePi();
	const { ctx } = fakeFooterCtx({ sessionName: "billing-core" });
	const reports: Array<string | null> = [];
	await followRosterLabel({ pi, ctx, agentDir, sink: (label) => reports.push(label) });
	return { pi, reports };
}

describe("following the roster label", () => {
	test("reports the record the bus wrote for this session", async () => {
		const { reports } = await follow(busWith("sess", "billing-core").agentDir);
		expect(reports).toEqual(["billing-core"]);
	});

	test("reports nothing for a session with no record, or only a peer's record", async () => {
		const empty = await follow(temps.track(scratchDir(temps, "pi-footer-label-")));
		const peerOnly = await follow(busWith("s-other", "billing-core").agentDir);
		expect(empty.reports).toEqual([]);
		expect(peerOnly.reports).toEqual([]);
	});

	test("takes its own published label and ignores a peer's", async () => {
		const { pi, reports } = await follow(temps.track(scratchDir(temps, "pi-footer-label-")));
		// The channel reaches every session in the process: a peer's label would put its name
		// on this session's bar.
		pi.events.emit(SESSION_LABEL_CHANNEL, { id: "s-other", label: "billing-lead" });
		expect(reports).toEqual([]);
		// A join settles the label without the session moving, which is why the bar cannot
		// carry this in the snapshot's memo key.
		pi.events.emit(SESSION_LABEL_CHANNEL, { id: "sess", label: "rose" });
		expect(reports).toEqual(["rose"]);
	});
});

describe("the session segment", () => {
	test("draws the roster label in place of Pi's session name", () => {
		const segment = sessionSegment(fullSnapshot({ sessionName: "billing-core", rosterLabel: "rose" }), fakeTheme);
		expect(segment?.forms.at(-1)).toContain("rose");
		expect(segment?.forms.join(" ")).not.toContain("billing-core");
	});

	test("falls back to Pi's session name, and drops when neither is known", () => {
		const named = sessionSegment(fullSnapshot({ sessionName: "billing-core", rosterLabel: null }), fakeTheme);
		expect(named?.forms.at(-1)).toContain("billing-core");
		expect(sessionSegment(fullSnapshot({ sessionName: null, rosterLabel: null }), fakeTheme)).toBeNull();
	});

	test("a label longer than the bar truncates the way a session name does", () => {
		const long = sessionSegment(fullSnapshot({ rosterLabel: "billing-core-with-a-long-tail" }), fakeTheme);
		expect(long?.forms).toHaveLength(2);
		expect(long?.forms[1]).not.toBe(long?.forms[0]);
	});
});

describe("the snapshot", () => {
	test("carries the label it is given, and null when it is given none", () => {
		const ctx = fakeFooterCtx({ sessionName: "billing-core" });
		const footerData = {
			getGitBranch: () => "main",
			getExtensionStatuses: () => new Map<string, string>(),
			getAvailableProviderCount: () => 1,
			onBranchChange: () => () => {},
		};
		const read = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, createDelegationLedger(), () => "rose");
		expect(read(ctx.ctx, footerData).rosterLabel).toBe("rose");
		const fallback = createSnapshotReader(DEFAULT_BYTEFLY_CONFIG, createDelegationLedger());
		expect(fallback(ctx.ctx, footerData).rosterLabel).toBeNull();
	});
});

describe("the installed footer", () => {
	test("draws the record's label once it lands, then the one the bus publishes", async () => {
		await withAgentDir(async (agentDir) => {
			// A record the bus wrote before this process started: the same session in another pane.
			const dir = join(agentDir, BUS_DIR_NAME, "key", SESSIONS_DIR_NAME);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "record.json"),
				JSON.stringify({ id: "sess", label: "tom", mode: "tui", lastSeen: 1 }),
				"utf-8",
			);

			const { pi } = makeFakePi();
			const { ctx, footerData, footers } = fakeFooterCtx({ sessionName: "billing-core" });
			registerFooter(pi);
			await emit(pi, "session_start", { reason: "startup" }, ctx);
			const frame = () => renderFooter(footers.at(-1), footerData).join("\n");
			// The footer is installed before the label is read, so the first frame is Pi's name.
			expect(frame()).toContain("[billing-core]");
			await waitFor(() => frame().includes("[tom]"));

			// A join settles a new label and the bus publishes it; the next frame names the
			// session the way a card, a handoff, and `/team` do.
			pi.events.emit(SESSION_LABEL_CHANNEL, { id: "sess", label: "rose" });
			expect(frame()).toContain("[rose]");
			expect(frame()).not.toContain("[billing-core]");
		});
	});
});
