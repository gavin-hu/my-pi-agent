/**
 * The shared label rules: the cap, the one-line flattening, and the fallback
 * chain a session betrays its name with.
 *
 * These live in `lib/` because the board records a label on a card and
 * `session-bus` settles the one a session is addressed by, so the two must agree
 * character for character — a card that names `billing core` while the bus
 * answers to `billing-core` cannot be assigned.
 */

import { describe, expect, test } from "bun:test";
import {
	agentLabel,
	checkoutNames,
	defaultLabel,
	isTeammate,
	labelKey,
	MAX_LABEL,
	MAX_TEAMMATES,
	normalizeLabel,
	normalizeTeammates,
	sameLabel,
	SAME_LABEL_JS,
	shortId,
	TEAM_AGENT_PREFIX,
} from "./session-label.ts";

describe("normalizeLabel", () => {
	test("collapses whitespace and trims", () => {
		expect(normalizeLabel("  billing   core \n", "fallback")).toBe("billing core");
	});

	test("falls back when the name is empty or missing", () => {
		expect(normalizeLabel(undefined, "fallback")).toBe("fallback");
		expect(normalizeLabel("   ", "fallback")).toBe("fallback");
	});

	test("keeps one line, so a label cannot wrap a row or open a second line", () => {
		expect(normalizeLabel("a\r\nb", "fallback")).toBe("a b");
	});

	test("caps the label, and the cap is what a target may be", () => {
		const long = "x".repeat(MAX_LABEL + 20);
		expect(normalizeLabel(long, "fallback")).toHaveLength(MAX_LABEL);
	});
});

describe("shortId", () => {
	test("keeps the tail of the alphanumerics", () => {
		expect(shortId("2026-10-25-abc123")).toBe("abc123");
	});

	test("survives an id with nothing alphanumeric in it", () => {
		expect(shortId("----")).toBe("----");
	});
});

describe("sameLabel", () => {
	test("reads one name in either case, because a label is a send target", () => {
		// `/team join Billing-Core` and a record's `billing-core` are one peer; a comparison that
		// said otherwise would record an owner no `session send` resolves.
		expect(sameLabel("billing-core", "Billing-Core")).toBe(true);
		expect(sameLabel("billing-core", "billing-core")).toBe(true);
	});

	test("keeps two different names apart, near spellings included", () => {
		expect(sameLabel("billing-core", "billing-core-2")).toBe(false);
		expect(sameLabel("billing core", "billing-core")).toBe(false);
	});

	test("keys a label the same way whichever spelling a map was written with", () => {
		// The comparison's other half: a map keyed by one spelling and looked up by another is the
		// same drift, so both sides ask this module for the key.
		const held = new Map([[labelKey("Billing-Core"), "cards"]]);
		expect(labelKey("billing-core")).toBe(labelKey("Billing-Core"));
		expect(held.get(labelKey("billing-core"))).toBe("cards");
	});

	test("crosses to the page as the same body, safe to splice into a script", () => {
		// The Team tab's history row calls this body (`HISTORY_OWNER_JS` is spliced beside it), and
		// a fragment has no import graph: the source has to stand alone, and it has to answer alike.
		expect(SAME_LABEL_JS).toBe(String(sameLabel));
		expect(SAME_LABEL_JS).not.toContain("`");
		expect(SAME_LABEL_JS).not.toContain("${");
		const browser = new Function(`return (${SAME_LABEL_JS});`)() as typeof sameLabel;
		for (const [a, b] of [
			["billing-core", "BILLING-CORE"],
			["billing-core", "billing-core-2"],
		] as const) {
			expect(browser(a, b)).toBe(sameLabel(a, b));
		}
	});
});

describe("agentLabel", () => {
	test("names the session after the tail of its id", () => {
		expect(agentLabel("session-9f21ac3b")).toBe("team-agent-21ac3b");
	});

	test("derives the same name every time, whatever the user calls the session", () => {
		// The point of deriving it: a rename cannot strand the card that recorded the name.
		expect(agentLabel("session-9f21ac3b")).toBe(agentLabel("session-9f21ac3b"));
		expect(agentLabel("session-9f21ac3b")).not.toBe(agentLabel("session-00000000"));
	});

	test("stays one line and inside the cap, because it is a target", () => {
		const label = agentLabel(`x-${"y".repeat(MAX_LABEL * 2)}`);
		expect(label.length).toBeLessThanOrEqual(MAX_LABEL);
		expect(label.startsWith(TEAM_AGENT_PREFIX)).toBe(true);
		expect(agentLabel("a\nb")).toBe("team-agent-ab");
	});

	test("keeps a name even when the id has nothing alphanumeric in it", () => {
		expect(agentLabel("----")).toBe("team-agent-----");
	});
});

describe("normalizeTeammates", () => {
	test("keeps the labels the file states, in the order it states them", () => {
		expect(normalizeTeammates(["sam", "gavin", "tom"])).toEqual(["sam", "gavin", "tom"]);
	});

	test("keeps any name, because the project's list is the whole vocabulary", () => {
		expect(normalizeTeammates(["billing-core", "api-core"])).toEqual(["billing-core", "api-core"]);
	});

	test("a name is one line, lowercased, and capped like every label", () => {
		// `Gavin` is `gavin` compared without case, the way a label is addressed.
		expect(normalizeTeammates(["  Gavin  ", "billing\r\ncore"])).toEqual(["gavin", "billing core"]);
		expect(normalizeTeammates(["x".repeat(MAX_LABEL + 20)])[0]).toHaveLength(MAX_LABEL);
	});

	test("drops a value that is not a string, a blank name, and a duplicate", () => {
		expect(normalizeTeammates(["gavin", 7, "  ", "Gavin", "tom", null])).toEqual(["gavin", "tom"]);
	});

	test("keeps the base it is handed when the file states none", () => {
		expect(normalizeTeammates(undefined, ["tom"])).toEqual(["tom"]);
		expect(normalizeTeammates("gavin", ["tom"])).toEqual(["tom"]);
	});

	test("an empty list is a project saying nobody is on its team, not a file that said nothing", () => {
		expect(normalizeTeammates([])).toEqual([]);
		expect(normalizeTeammates([], ["tom"])).toEqual([]);
	});

	test("keeps at most MAX_TEAMMATES names, which is the cap this change introduced", () => {
		const many = Array.from({ length: MAX_TEAMMATES + 5 }, (_, index) => `mate-${index}`);
		expect(normalizeTeammates(many)).toHaveLength(MAX_TEAMMATES);
		expect(normalizeTeammates(many).at(-1)).toBe(`mate-${MAX_TEAMMATES - 1}`);
	});
});

describe("isTeammate", () => {
	const team = ["gavin", "billing-core"];

	test("compares without case, the way a label is addressed", () => {
		expect(isTeammate("Gavin", team)).toBe(true);
		expect(isTeammate("team-agent-21ac3b", team)).toBe(false);
	});

	test("answers false for a name nobody has", () => {
		expect(isTeammate(null, team)).toBe(false);
		expect(isTeammate(undefined, team)).toBe(false);
		expect(isTeammate("", team)).toBe(false);
		expect(isTeammate("gavin", [])).toBe(false);
	});
});

describe("checkoutNames", () => {
	const trees = [
		{ path: "/repo/my-pi-agent", branch: "main" },
		{ path: "/repo/my-pi-agent/.pi/worktrees/peer-shutdown", branch: "worktree-peer-shutdown" },
	];

	test("names every checkout by its directory and its branch", () => {
		expect([...checkoutNames(trees)].sort()).toEqual([
			"main",
			"my-pi-agent",
			"peer-shutdown",
			"worktree-peer-shutdown",
		]);
	});

	test("names the branch without the default worktree prefix, both ways", () => {
		// A directory is the name a session actually borrows; the branch is here because a
		// join once stamped the branch into Pi's name, and `/resume` keeps that longer.
		expect(checkoutNames([{ path: "/elsewhere", branch: "worktree-billing" }])).toEqual(
			new Set(["elsewhere", "worktree-billing", "billing"]),
		);
	});

	test("compares without case, the way a label is addressed", () => {
		expect(checkoutNames([{ path: "/repo/Frontend", branch: "Worktree-UI" }])).toEqual(
			new Set(["frontend", "worktree-ui", "ui"]),
		);
	});

	test("a path with no last segment names nothing", () => {
		expect(checkoutNames([{ path: "/" }])).toEqual(new Set());
	});
});

describe("defaultLabel", () => {
	const worktree = [
		{ path: "/repo/my-pi-agent", branch: "main" },
		{ path: "/repo/my-pi-agent/.pi/worktrees/peer-shutdown", branch: "worktree-peer-shutdown" },
	];

	test("prefers the Pi session name", () => {
		expect(defaultLabel({ sessionName: "billing lead", cwd: "/repo/somewhere", id: "id-1" })).toBe("billing lead");
	});

	test("falls back to the working directory's basename", () => {
		expect(defaultLabel({ cwd: "/repo/my-pi-agent", id: "id-1" })).toBe("my-pi-agent");
		expect(defaultLabel({ sessionName: "   ", cwd: "/repo/my-pi-agent", id: "id-1" })).toBe("my-pi-agent");
	});

	test("names the repository, not the worktree it sits in", () => {
		expect(
			defaultLabel({ cwd: "/repo/my-pi-agent/.pi/worktrees/peer-shutdown", id: "id-1", checkouts: worktree }),
		).toBe("my-pi-agent");
		// A subdirectory of the checkout is the same repository as its root.
		expect(defaultLabel({ cwd: "/repo/my-pi-agent/lib", id: "id-1", checkouts: worktree })).toBe("my-pi-agent");
	});

	test("declines a session name that merely repeats a checkout", () => {
		for (const sessionName of ["peer-shutdown", "worktree-peer-shutdown", "Peer-Shutdown"]) {
			expect(
				defaultLabel({ sessionName, cwd: "/repo/my-pi-agent", id: "id-1", checkouts: worktree }),
				sessionName,
			).toBe("my-pi-agent");
		}
	});

	test("keeps a name that is not a checkout's", () => {
		expect(defaultLabel({ sessionName: "billing-core", cwd: "/repo/my-pi-agent", checkouts: worktree })).toBe(
			"billing-core",
		);
	});

	test("falls back to `session` when there is no name and no directory to borrow", () => {
		expect(defaultLabel({ cwd: "/", id: "session-9191" })).toBe("session");
	});

	test("a windows path borrows its last segment too", () => {
		expect(defaultLabel({ cwd: "C:\\work\\billing", id: "id-1" })).toBe("billing");
	});

	test("ends on the id when even the repository has no name", () => {
		expect(defaultLabel({ cwd: "/", id: "session-9191", checkouts: [{ path: "/" }] })).toBe("session");
	});
});
