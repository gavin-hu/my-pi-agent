/**
 * The session's name on the bar: the roster label when the bus has one, then Pi's own name.
 *
 * Two facts meet here and only one of them is Pi's — a session name the terminal knows, and a
 * label a peer addresses. So the cases are what the follower reports (this session's record,
 * this session's event, not a peer's), and what the installed footer draws when the record
 * holds a teammate name the session's own name is not: the label is the source, and a label
 * the team does not hold draws nothing rather than falling back.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUS_DIR_NAME, SESSIONS_DIR_NAME } from "../../../../lib/session-roster.ts";
import { SESSION_LABEL_CHANNEL } from "../../../../lib/session-label.ts";
import { scratchDir, withAgentDir } from "../../../../test/helpers/env.ts";
import { emit, makeFakePi } from "../../../../test/helpers/fakes.ts";
import { fakeFooterCtx, renderFooter } from "../../../../test/helpers/fixtures/footer.ts";
import { makeTempTracker } from "../../../../test/helpers/git.ts";
import { waitFor } from "../../../../test/helpers/process.ts";
import { followRosterLabel } from "./label.ts";
import { registerFooter } from "../register.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** An agent directory holding one repository's bus, with one record in it. */
function busWith(id: string, label: string): string {
	const agentDir = temps.track(scratchDir(temps, "pi-footer-label-"));
	const dir = join(agentDir, BUS_DIR_NAME, "key", SESSIONS_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "record.json"), JSON.stringify({ id, label, mode: "tui", lastSeen: 1_000 }), "utf-8");
	return agentDir;
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
		const { reports } = await follow(busWith("sess", "billing-core"));
		expect(reports).toEqual(["billing-core"]);
	});

	test("reports nothing for a session with no record, or only a peer's record", async () => {
		const empty = await follow(temps.track(scratchDir(temps, "pi-footer-label-")));
		const peerOnly = await follow(busWith("s-other", "billing-core"));
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

describe("the installed footer's chip", () => {
	test("names the session from the bus record when Pi's own name is not on the team", async () => {
		await withAgentDir(async (agentDir) => {
			// The project's team holds `gavin` and not `billing-core`, and `/board` is what puts a
			// session on that record without renaming it: the chip follows the label, not Pi.
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ team: { teammates: ["gavin", "tom"] } }));
			const dir = join(agentDir, BUS_DIR_NAME, "key", SESSIONS_DIR_NAME);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "record.json"),
				JSON.stringify({ id: "sess", label: "gavin", mode: "tui", lastSeen: 1_000 }),
				"utf-8",
			);

			const { pi } = makeFakePi();
			const { ctx, footerData, footers } = fakeFooterCtx({ sessionName: "billing-core" });
			registerFooter(pi);
			await emit(pi, "session_start", { reason: "startup" }, ctx);
			const frame = () => renderFooter(footers.at(-1), footerData).join("\n");
			// The footer installs before the record is read, so the first frame names nobody.
			await waitFor(() => frame().includes("[gavin]"));
			expect(frame()).toContain("[gavin]");
			expect(frame()).not.toContain("[billing-core]");
		});
	});

	test("follows the label a join publishes, and draws nothing for one the team refuses", async () => {
		await withAgentDir(async (agentDir) => {
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ team: { teammates: ["gavin", "tom"] } }));
			const dir = join(agentDir, BUS_DIR_NAME, "key", SESSIONS_DIR_NAME);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "record.json"),
				JSON.stringify({ id: "sess", label: "gavin", mode: "tui", lastSeen: 1_000 }),
				"utf-8",
			);

			const { pi } = makeFakePi();
			const { ctx, footerData, footers } = fakeFooterCtx({ sessionName: "billing-core" });
			registerFooter(pi);
			await emit(pi, "session_start", { reason: "startup" }, ctx);
			const frame = () => renderFooter(footers.at(-1), footerData).join("\n");
			await waitFor(() => frame().includes("[gavin]"));

			// A later join settles a new label and the bus publishes it; the next frame names the
			// session the way a card, a handoff, and `/team` do.
			pi.events.emit(SESSION_LABEL_CHANNEL, { id: "sess", label: "tom" });
			expect(frame()).toContain("[tom]");
			expect(frame()).not.toContain("[gavin]");

			// A label the team does not hold is not replaced by Pi's session name: the bar names
			// nobody rather than a word the team never agreed to.
			pi.events.emit(SESSION_LABEL_CHANNEL, { id: "sess", label: "billing-core" });
			expect(frame()).not.toContain("[");
		});
	});
});
