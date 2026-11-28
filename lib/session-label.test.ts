/**
 * The shared label rules: the cap, the one-line flattening, and the fallback
 * chain a session betrays its name with.
 *
 * These live in `lib/` because the board records a label on a card and
 * `session-bus` settles the one a session is addressed by, so the two must agree
 * character for character — a card that names `billing core` while the bus
 * answers to `billing-core` cannot be assigned.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeBusRecord } from "../test/helpers/bus.ts";
import { tempDir } from "../test/helpers/env.ts";
import { makeTempTracker } from "../test/helpers/git.ts";
import { canCreateSymlinks } from "../test/helpers/platform.ts";
import { BUS_DIR_NAME, SESSIONS_DIR_NAME } from "./session-files.ts";
import {
	agentLabel,
	checkoutNames,
	defaultLabel,
	isTeammate,
	LABEL_KEY_JS,
	labelKey,
	MAX_LABEL,
	MAX_TEAMMATES,
	normalizeLabel,
	normalizeTeammates,
	readSessionLabel,
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
	test("keeps the last six characters, punctuation and all", () => {
		expect(shortId("2026-10-25-abc123")).toBe("abc123");
		expect(shortId("s-core")).toBe("s-core");
	});

	test("survives an id with nothing alphanumeric in it", () => {
		expect(shortId("----")).toBe("----");
	});

	test("neutralizes a tail that carries an escape", () => {
		expect(shortId("abcde\u001bzzzzz")).toBe("zzzzz");
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
		const browser = new Function(`return (${SAME_LABEL_JS});`)() as typeof sameLabel;
		for (const [a, b] of [
			["billing-core", "BILLING-CORE"],
			["billing-core", "billing-core-2"],
		] as const) {
			expect(browser(a, b)).toBe(sameLabel(a, b));
		}
	});

	test("carries the key half to the page too, because a fragment keys its own maps", () => {
		// The roster and active fragments write `owners[<key>]` and look it up with a label the
		// snapshot produced, so the key a page uses has to be this module's, not a third spelling.
		expect(LABEL_KEY_JS).toBe(String(labelKey));
		const browser = new Function(`return (${LABEL_KEY_JS});`)() as typeof labelKey;
		expect(browser("Billing-Core")).toBe(labelKey("Billing-Core"));
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

const temps = makeTempTracker();
afterAll(() => temps.flush());

describe("readSessionLabel", () => {
	const NOW = 1_000_000;

	/** One agent directory holding this repository's bus store under an id. */
	function storeUnder(agentDir: string, id = "bc55"): string {
		const dir = join(agentDir, "repos", id, BUS_DIR_NAME);
		mkdirSync(join(dir, SESSIONS_DIR_NAME), { recursive: true });
		return dir;
	}

	/** The flat tree #771 replaced: one bus per path key, as a repository that has not moved keeps. */
	function flatKey(agentDir: string, key: string): string {
		const dir = join(agentDir, BUS_DIR_NAME, key);
		mkdirSync(join(dir, SESSIONS_DIR_NAME), { recursive: true });
		return dir;
	}

	/**
	 * A record in the shape the bus writes, including the directories a legacy record is scoped by.
	 *
	 * The required fields are filled in unless a case names them: since #994 this reader requires
	 * what the bus requires, so a fixture without `pid` would describe a file no writer produces.
	 */
	function write(dir: string, name: string, record: Record<string, unknown>): void {
		const full = { mode: "tui", pid: process.pid, cwd: dir, repoRoot: dir, startedAt: 50, lastSeen: 100, ...record };
		writeFileSync(join(dir, SESSIONS_DIR_NAME, name), JSON.stringify(full), "utf-8");
	}

	test("finds the record in the store the bus files it in", async () => {
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		writeBusRecord(storeUnder(agentDir), { id: "s-1", label: "billing-core", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1")).toBe("billing-core");
	});

	test("answers a record still in the flat tree, when it is this session's own", async () => {
		// The one-release read: a repository the mover has not reached keeps its records under a path
		// key, and the record's own directory is what says they are this session's.
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		write(flatKey(agentDir, "abc123"), "s-1.json", {
			id: "s-1",
			label: "billing-core",
			lastSeen: NOW,
			cwd,
			repoRoot: cwd,
		});
		expect(await readSessionLabel(agentDir, "s-1", { cwd })).toBe("billing-core");
	});

	test("never answers from another repository's flat key", async () => {
		// The flat tree holds every repository's key, so a walk that took the first id match could put
		// another repository's label on this session's bar.
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const mine = temps.track(tempDir("pi-repo-"));
		const theirs = temps.track(tempDir("pi-repo-"));
		write(flatKey(agentDir, "def456"), "s-1.json", {
			id: "s-1",
			label: "their-label",
			lastSeen: NOW,
			cwd: theirs,
			repoRoot: theirs,
		});
		expect(await readSessionLabel(agentDir, "s-1", { cwd: mine })).toBeUndefined();
	});

	test("reads the store alone when it is given no cwd, and by id rather than by store", async () => {
		// A session id is unique, so any store that holds it answers; without a `cwd` the flat tree is
		// not guessed at, because a match there is not evidence of which repository it belongs to.
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		write(flatKey(agentDir, "abc123"), "s-1.json", { id: "s-1", label: "flat", lastSeen: NOW, cwd, repoRoot: cwd });
		expect(await readSessionLabel(agentDir, "s-1")).toBeUndefined();
		writeBusRecord(storeUnder(agentDir, "other"), { id: "s-1", label: "billing-core", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1")).toBe("billing-core");
	});

	test("prefers the store over the flat tree when both name the session", async () => {
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const cwd = temps.track(tempDir("pi-repo-"));
		write(flatKey(agentDir, "abc123"), "s-1.json", { id: "s-1", label: "flat", lastSeen: NOW, cwd, repoRoot: cwd });
		writeBusRecord(storeUnder(agentDir), { id: "s-1", label: "billing-core", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1", { cwd })).toBe("billing-core");
	});

	const symlinkTest = (canCreateSymlinks() ? test : test.skip) as typeof test;

	symlinkTest("takes a symlinked spelling of this directory as the same repository", async () => {
		// A checkout reached through a link is the same repository, so the scope test compares real
		// paths: a string comparison would refuse a session whose own directory is the link's target.
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const real = temps.track(tempDir("pi-repo-"));
		const link = join(temps.track(tempDir("pi-link-")), "checkout");
		symlinkSync(real, link, "dir");
		write(flatKey(agentDir, "abc123"), "s-1.json", {
			id: "s-1",
			label: "billing-core",
			lastSeen: NOW,
			cwd: real,
			repoRoot: real,
		});
		expect(await readSessionLabel(agentDir, "s-1", { cwd: link })).toBe("billing-core");
	});

	test("answers undefined for a session no record names, and with no bus at all", async () => {
		const empty = temps.track(tempDir("pi-bus-agent-"));
		expect(await readSessionLabel(empty, "s-1")).toBeUndefined();
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		writeBusRecord(storeUnder(agentDir), { id: "s-2", label: "billing-lead", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1")).toBeUndefined();
	});

	test("does not take a file the bus's own shape refuses, nor one that will not parse", async () => {
		// An id and a name alone are not a record: a half-written file must not name the session, and a
		// file that is not JSON costs itself rather than the walk.
		const agentDir = temps.track(tempDir("pi-bus-agent-"));
		const dir = storeUnder(agentDir);
		writeFileSync(join(dir, SESSIONS_DIR_NAME, "broken.json"), "{ not json\n", "utf-8");
		writeFileSync(join(dir, SESSIONS_DIR_NAME, "half.json"), JSON.stringify({ id: "s-1", label: "half" }), "utf-8");
		expect(await readSessionLabel(agentDir, "s-1")).toBeUndefined();
		writeBusRecord(dir, { id: "s-1", label: "billing-core", lastSeen: NOW });
		expect(await readSessionLabel(agentDir, "s-1")).toBe("billing-core");
	});
});
