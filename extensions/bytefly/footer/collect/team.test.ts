/**
 * The team the bar draws from: the `team.teammates` list, read at install and again when this
 * session's own `/team join` says it changed.
 *
 * The rule the bar obeys is one comparison — is this session's name one of the team's — so
 * the cases are what the reader answers for a file that states a team, one that states
 * nothing, and one that cannot be read, and what the installed footer draws for a session
 * the team holds against one it does not, before and after the team grows under it.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TEAM_CHANGED_CHANNEL } from "../../../../lib/events.ts";
import { tempDir, withAgentDir } from "../../../../test/helpers/env.ts";
import { emit, makeFakePi } from "../../../../test/helpers/fakes.ts";
import { fakeFooterCtx, renderFooter } from "../../../../test/helpers/fixtures/footer.ts";
import { makeTempTracker } from "../../../../test/helpers/git.ts";
import { settle, waitFor } from "../../../../test/helpers/process.ts";
import { readTeammates } from "./team.ts";
import { registerFooter } from "../register.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** A project whose `.pi/bytefly.json` holds `document`, or holds `document` as broken text. */
function projectWith(document: unknown): string {
	const cwd = temps.track(tempDir("pi-footer-team-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "bytefly.json"), typeof document === "string" ? document : JSON.stringify(document));
	return cwd;
}

describe("readTeammates", () => {
	test("reads the team the project's section states", () => {
		const cwd = projectWith({ team: { teammates: ["gavin", "jack"] } });
		const agentDir = temps.track(tempDir("pi-footer-team-agent-"));
		expect(readTeammates(cwd, { agentDir })).toEqual(["gavin", "jack"]);
	});

	test("answers the loader's default team when the file states none, and a stated empty list when it says nobody", () => {
		const agentDir = temps.track(tempDir("pi-footer-team-agent-"));
		// A file that names no team leaves the loader's default roster, so the bar still has a
		// vocabulary to match; unreadable text is the same answer as an absent section.
		expect(readTeammates(projectWith({}), { agentDir })).toEqual(["gavin", "tom", "jack", "mike", "sam"]);
		expect(readTeammates(projectWith("{ not json"), { agentDir })).toEqual(["gavin", "tom", "jack", "mike", "sam"]);
		// An empty list is a project saying nobody is on its team, which is an answer and not a gap.
		expect(readTeammates(projectWith({ team: { teammates: [] } }), { agentDir })).toEqual([]);
	});
});

describe("the installed footer's teammate chip", () => {
	test("draws the name the team holds, and nothing at all for a session it does not", async () => {
		await withAgentDir(async (agentDir) => {
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ team: { teammates: ["gavin", "jack"] } }));

			const { pi } = makeFakePi();
			registerFooter(pi);
			const held = fakeFooterCtx({ sessionName: "jack" });
			await emit(pi, "session_start", { reason: "startup" }, held.ctx);
			const frame = () => renderFooter(held.footers.at(-1), held.footerData).join("\n");
			// The footer installs before the team is read, so the first frame draws no chip.
			await waitFor(() => frame().includes("[jack]"));
			expect(frame()).toContain("[jack]");

			// The same team, a session it does not hold: the bar names nobody rather than
			// drawing a name the team never agreed to.
			const stranger = fakeFooterCtx({ sessionName: "billing-core" });
			await emit(pi, "session_start", { reason: "startup" }, stranger.ctx);
			const strangerFrame = renderFooter(stranger.footers.at(-1), stranger.footerData).join("\n");
			expect(strangerFrame).toContain("repo/project");
			expect(strangerFrame).not.toContain("[");
		});
	});

	test("draws no chip at all when the team states nobody", async () => {
		await withAgentDir(async (agentDir) => {
			// A stated empty list clears the default roster, so the bar has no name to match: this is the
			// state in which the location is drawn and the name is not.
			writeFileSync(join(agentDir, "bytefly.json"), JSON.stringify({ team: { teammates: [] } }));
			const { pi } = makeFakePi();
			registerFooter(pi);
			const named = fakeFooterCtx({ sessionName: "gavin" });
			await emit(pi, "session_start", { reason: "startup" }, named.ctx);
			await settle();
			const frame = renderFooter(named.footers.at(-1), named.footerData).join("\n");
			expect(frame).toContain("repo/project");
			expect(frame).not.toContain("[gavin]");
		});
	});

	test("draws a name the team took on after the install, when this session says it changed", async () => {
		await withAgentDir(async () => {
			const cwd = projectWith({ team: { teammates: ["gavin"] } });
			const { pi } = makeFakePi();
			registerFooter(pi);
			const named = fakeFooterCtx({ sessionName: "lily", cwd });
			await emit(pi, "session_start", { reason: "startup" }, named.ctx);
			const frame = () => renderFooter(named.footers.at(-1), named.footerData).join("\n");
			// The team this bar read does not hold `lily`, so it names nobody yet.
			await waitFor(() => frame().length > 0);
			await settle();
			expect(frame()).not.toContain("[lily]");

			// `/team join lily` writes the name and then says the team changed: the bar re-reads
			// instead of staying nameless until the next session tree.
			writeFileSync(join(cwd, ".pi", "bytefly.json"), JSON.stringify({ team: { teammates: ["gavin", "lily"] } }));
			pi.events.emit(TEAM_CHANGED_CHANNEL, { cwd });
			await waitFor(() => frame().includes("[lily]"));
			expect(frame()).toContain("[lily]");
		});
	});

	test("keeps the team it read when another directory's team changes", async () => {
		await withAgentDir(async () => {
			const cwd = projectWith({ team: { teammates: ["gavin"] } });
			const other = projectWith({ team: { teammates: ["gavin", "lily"] } });
			const { pi } = makeFakePi();
			registerFooter(pi);
			const named = fakeFooterCtx({ sessionName: "lily", cwd });
			await emit(pi, "session_start", { reason: "startup" }, named.ctx);
			const frame = () => renderFooter(named.footers.at(-1), named.footerData).join("\n");
			await waitFor(() => frame().length > 0);
			// One bar names this session from the team it is showing, not from a repository
			// that joined somebody else.
			pi.events.emit(TEAM_CHANGED_CHANNEL, { cwd: other });
			await settle(20);
			expect(frame()).not.toContain("[lily]");
		});
	});
});
