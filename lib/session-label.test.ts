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
	DEFAULT_TEAM_SIZE,
	DEFAULT_TEAMMATES,
	defaultLabel,
	isTeammate,
	MAX_LABEL,
	normalizeLabel,
	normalizeTeammates,
	presetNameFor,
	shortId,
	TEAM_AGENT_PREFIX,
	TEAMMATE_NAMES,
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

describe("TEAMMATE_NAMES", () => {
	test("are distinct names a person answers to, not derived ids", () => {
		expect(new Set(TEAMMATE_NAMES).size).toBe(TEAMMATE_NAMES.length);
		for (const name of TEAMMATE_NAMES) {
			// A name is a label, so it is already one line, inside the cap, and one word.
			expect(normalizeLabel(name, ""), name).toBe(name);
			expect(name, name).toMatch(/^[a-z]{2,8}$/);
		}
	});
});

describe("DEFAULT_TEAMMATES", () => {
	test("is the head of the built-in set, so the default team cannot hold a name the set dropped", () => {
		expect(DEFAULT_TEAMMATES).toEqual(TEAMMATE_NAMES.slice(0, DEFAULT_TEAM_SIZE));
		expect(DEFAULT_TEAMMATES).toHaveLength(DEFAULT_TEAM_SIZE);
	});

	test("is the lead and the four beside him, because the male presets lead the set", () => {
		expect(DEFAULT_TEAMMATES).toEqual(["gavin", "tom", "jack", "mike", "sam"]);
	});
});

describe("normalizeTeammates", () => {
	test("keeps the names the set holds, in the order the file states them", () => {
		expect(normalizeTeammates(["sam", "gavin", "tom"])).toEqual(["sam", "gavin", "tom"]);
	});

	test("drops a name the set does not hold, a value that is not a name, and a duplicate", () => {
		// `Gavin` is `gavin` compared without case, the way a label is addressed.
		expect(normalizeTeammates(["gavin", "billing-lead", 7, "Gavin", "tom"])).toEqual(["gavin", "tom"]);
	});

	test("keeps the base it is handed when the file says nothing usable", () => {
		expect(normalizeTeammates(undefined)).toEqual(DEFAULT_TEAMMATES);
		expect(normalizeTeammates([])).toEqual(DEFAULT_TEAMMATES);
		expect(normalizeTeammates(["billing-lead"])).toEqual(DEFAULT_TEAMMATES);
		expect(normalizeTeammates(undefined, ["tom"])).toEqual(["tom"]);
	});
});

describe("isTeammate", () => {
	test("compares without case, the way a label is addressed", () => {
		expect(isTeammate("Gavin", DEFAULT_TEAMMATES)).toBe(true);
		expect(isTeammate("billing-lead", DEFAULT_TEAMMATES)).toBe(false);
	});

	test("answers false for a name nobody has", () => {
		expect(isTeammate(null, DEFAULT_TEAMMATES)).toBe(false);
		expect(isTeammate(undefined, DEFAULT_TEAMMATES)).toBe(false);
		expect(isTeammate("", DEFAULT_TEAMMATES)).toBe(false);
	});
});

describe("presetNameFor", () => {
	test("draws the same name for the same id every time", () => {
		const drawn = presetNameFor("session-9f21ac3b");
		if (drawn === undefined) throw new Error("the pool is empty");
		const pool: readonly string[] = TEAMMATE_NAMES;
		expect(pool).toContain(drawn);
		expect(presetNameFor("session-9f21ac3b")).toBe(drawn);
	});

	test("spreads different sessions across the list", () => {
		const ids = Array.from({ length: 40 }, (_, index) => `session-${index}`);
		const drawn = new Set(ids.map((id) => presetNameFor(id)));
		expect(drawn.size).toBeGreaterThan(5);
	});

	test("skips a name a live teammate holds, and walks on to the next free one", () => {
		const first = presetNameFor("s-1");
		if (first === undefined) throw new Error("the pool is empty");
		const second = presetNameFor("s-1", [first]);
		if (second === undefined) throw new Error("the pool is empty");
		expect(second).not.toBe(first);
		expect(presetNameFor("s-1", [first, second])).not.toBe(first);
		expect(presetNameFor("s-1", [first, second])).not.toBe(second);
	});

	test("compares a held label the way a peer is addressed: without case", () => {
		const first = presetNameFor("s-1");
		if (first === undefined) throw new Error("the pool is empty");
		expect(presetNameFor("s-1", [first.toUpperCase()])).not.toBe(first);
	});

	test("answers nothing when every name is taken, so the caller can fall back", () => {
		expect(presetNameFor("s-1", TEAMMATE_NAMES)).toBeUndefined();
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
