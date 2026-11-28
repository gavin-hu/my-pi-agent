/**
 * The session's name on the bar: the label the bus recorded for it, and nothing when there is none.
 *
 * A session name the terminal knows and a label a peer addresses are two facts, and the bar draws
 * only the second. So the cases are what the follower reports (this session's record, this
 * session's event, not a peer's), and what the installed footer draws: the label a join settled,
 * and none at all for a session with no join behind it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUS_DIR_NAME, SESSIONS_DIR_NAME } from "../../../../lib/session-files.ts";
import { SESSION_LABEL_CHANNEL } from "../../../../lib/session-label.ts";
import { scratchDir, withAgentDir } from "../../../../test/helpers/env.ts";
import { emit, makeFakePi } from "../../../../test/helpers/fakes.ts";
import { fakeFooterCtx, renderFooter } from "../../../../test/helpers/fixtures/footer.ts";
import { makeTempTracker } from "../../../../test/helpers/git.ts";
import { waitFor, settle } from "../../../../test/helpers/process.ts";
import { registerFooter } from "../register.ts";
import { followRosterLabel } from "./label.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** An agent directory holding one repository's bus, with one record in it. */
function busWith(id: string, label: string): string {
	const agentDir = temps.track(scratchDir(temps, "pi-footer-label-"));
	const dir = join(agentDir, "repos", "bc55", BUS_DIR_NAME, SESSIONS_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "record.json"),
		JSON.stringify({
			id: id,
			label: label,
			mode: "tui",
			pid: 0,
			cwd: "/repo",
			repoRoot: "/repo",
			startedAt: 50,
			lastSeen: 1_000,
		}),
		"utf-8",
	);
	return agentDir;
}

/** Follow a session's label, and collect everything the follower reports. */
async function follow(
	agentDir: string,
): Promise<{ pi: ReturnType<typeof makeFakePi>["pi"]; reports: Array<string | null>; stop: () => void }> {
	const { pi } = makeFakePi();
	const { ctx } = fakeFooterCtx({ sessionName: "billing-core" });
	const reports: Array<string | null> = [];
	const follower = followRosterLabel({ pi, ctx, agentDir, sink: (label) => reports.push(label) });
	await follower.ready;
	return { pi, reports, stop: follower.stop };
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

	test("stops naming the transcript whose follower was dropped", async () => {
		const followed = await follow(temps.track(scratchDir(temps, "pi-footer-label-")));
		// A `/new` replaces the transcript inside one process and re-installs the footer: the install
		// that follows drops the listener the previous one made, or every reset would leave one behind.
		followed.stop();
		followed.pi.events.emit(SESSION_LABEL_CHANNEL, { id: "sess", label: "rose" });
		expect(followed.reports).toEqual([]);
	});
});

describe("the installed footer's chip", () => {
	test("draws nothing for a session Pi names as a teammate with no join behind it", async () => {
		await withAgentDir(async (agentDir) => {
			// The team holds `tom` and Pi names this session `tom`, and neither is a join: the bar
			// has no label of this session's own, so it names nobody.
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ team: { teammates: ["gavin", "tom"] } }));
			const { pi } = makeFakePi();
			const { ctx, footerData, footers } = fakeFooterCtx({ sessionName: "tom" });
			registerFooter(pi);
			await emit(pi, "session_start", { reason: "startup" }, ctx);
			await settle(20);
			const frame = renderFooter(footers.at(-1), footerData).join("\n");
			expect(frame).toContain("repo/project");
			expect(frame).not.toContain("[tom]");
		});
	});

	test("names the session from the bus record when Pi's own name is not on the team", async () => {
		await withAgentDir(async (agentDir) => {
			// The project's team holds `gavin` and not `billing-core`, and `/board` is what puts a
			// session on that record without renaming it: the chip follows the label, not Pi.
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ team: { teammates: ["gavin", "tom"] } }));
			const dir = join(agentDir, "repos", "bc55", BUS_DIR_NAME, SESSIONS_DIR_NAME);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "record.json"),
				JSON.stringify({
					id: "sess",
					label: "gavin",
					mode: "tui",
					pid: 0,
					cwd: "/repo",
					repoRoot: "/repo",
					startedAt: 50,
					lastSeen: 1_000,
				}),
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
			const dir = join(agentDir, "repos", "bc55", BUS_DIR_NAME, SESSIONS_DIR_NAME);
			mkdirSync(dir, { recursive: true });
			writeFileSync(
				join(dir, "record.json"),
				JSON.stringify({
					id: "sess",
					label: "gavin",
					mode: "tui",
					pid: 0,
					cwd: "/repo",
					repoRoot: "/repo",
					startedAt: 50,
					lastSeen: 1_000,
				}),
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
