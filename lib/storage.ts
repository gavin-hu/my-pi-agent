/**
 * The paths this package reserves, and the mode every store it owns is created with.
 *
 * Two questions, one module, because they are answered about the same paths: *is this name ours?*
 * (the registry) and *how is a directory a store owns made?* (the policy). A store is state — a
 * board, a mailbox, a plan, a job log — so it is owner-only, and a file in it is owner-read-write;
 * a path this package only reads (`agents/`), or one a config document creates in a project
 * (`.pi/bytefly.json`), is not a store and keeps whatever mode the writer it came from has.
 *
 * The split matters because the writer is shared: `lib/json.ts` publishes config documents and
 * project registries as well as store files, so its parent directory mode defaults to the umask's
 * and a *store* asks for the policy explicitly. That is why {@link ensurePrivateDir} exists rather
 * than a default on every mkdir in the package.
 *
 * Data only: no module-level state, and no I/O beyond the two helpers. `test/boundaries.test.ts`
 * holds the first half and the drift case in `test/drift.test.ts` holds the table against the docs
 * in both directions, so a path named in either table and written by neither cannot ship.
 */

import { chmodSync, mkdirSync, statSync } from "node:fs";

/** The mode a directory a store owns is created with: owner only. */
export const DIR_MODE = 0o700;

/** The mode a file a store owns is created with: owner read and write. */
export const FILE_MODE = 0o600;

/** Where a reserved path is filed: the project's `.pi`, or Pi's agent directory. */
export type StorageHome = "project" | "agent";

/** Whose path it is: this package's, Pi's own, or a directory a person fills. */
export type StorageOwner = "package" | "pi" | "you";

/** One path this package reserves. */
export interface ReservedPath {
	/** Which directory it is filed under. */
	home: StorageHome;
	/** Who the name belongs to. */
	owner: StorageOwner;
	/** Its name there: `board`, `memory.md`, `jobs`. */
	name: string;
	/** One line on what it holds, for a reader of the table. */
	holds: string;
	/**
	 * The extensions that write it.
	 *
	 * Empty for a path nobody in this package writes: Pi's own names, a directory a person fills
	 * (`agents/`), and the ones a script writes. The drift case compares this against the docs'
	 * `Written by` cell in both directions, which is what a row claiming a writer the code does
	 * not have fails on.
	 */
	written: readonly string[];
	/**
	 * The mode this package creates it with, or absent for a path it does not create.
	 *
	 * A store is owner-only; a worktree checkout, a cache directory and `agents/` are not this
	 * package's to narrow, and saying nothing is more honest than a mode that would be a guess.
	 */
	mode?: number;
}

/**
 * Every path either side writes, in both homes.
 *
 * The `.pi` rows are the ones `docs/configuration.md` has always listed, this package's and Pi's
 * together, because that table is what a reader consults before adding a file: a name that is not
 * here and not there is one the package does not reserve, and that is the answer the drift exists
 * to keep true.
 */
export const RESERVED_PATHS: readonly ReservedPath[] = [
	{
		home: "project",
		owner: "pi",
		name: "settings.json",
		holds: "Pi's project settings and package declarations",
		written: [],
	},
	{ home: "project", owner: "pi", name: "mcp.json", holds: "Pi's MCP servers", written: [] },
	{ home: "project", owner: "pi", name: "SYSTEM.md", holds: "Pi's project system prompt", written: [] },
	{ home: "project", owner: "pi", name: "APPEND_SYSTEM.md", holds: "text appended to the system prompt", written: [] },
	{ home: "project", owner: "pi", name: "extensions/", holds: "Pi's project extensions", written: [] },
	{ home: "project", owner: "pi", name: "skills/", holds: "Pi's project skills", written: [] },
	{ home: "project", owner: "pi", name: "prompts/", holds: "Pi's project prompt templates", written: [] },
	{ home: "project", owner: "pi", name: "themes/", holds: "Pi's project themes", written: [] },
	{
		home: "project",
		owner: "package",
		name: "bytefly.json",
		holds: "this project's overrides, one section per extension",
		written: ["bytefly", "team"],
	},
	{
		home: "project",
		owner: "package",
		name: "memory.md",
		holds: "the project memory store",
		written: ["memory"],
		mode: FILE_MODE,
	},
	{
		home: "project",
		owner: "package",
		name: "worktrees/",
		holds: "managed checkouts, and `index.json` for their registry",
		written: ["worktree"],
	},
	{ home: "project", owner: "you", name: "agents/", holds: "project agents, read-only", written: [] },
	{ home: "project", owner: "package", name: "cache/", holds: "the last red run's JUnit report", written: [] },
	{
		home: "agent",
		owner: "package",
		name: "bytefly.json",
		holds: "the global document, one section per extension",
		written: ["bytefly", "team"],
	},
	{
		home: "agent",
		owner: "package",
		name: "memory.md",
		holds: "global notes, injected into every run",
		written: ["memory"],
		mode: FILE_MODE,
	},
	{ home: "agent", owner: "you", name: "agents/", holds: "agent definitions a subagent may run", written: [] },
	{
		home: "agent",
		owner: "package",
		name: "board/",
		holds: "the board, one card per file",
		written: ["board"],
		mode: DIR_MODE,
	},
	{
		home: "agent",
		owner: "package",
		name: "session-bus/",
		holds: "sessions, mail, and path claims",
		written: ["session-bus"],
		mode: DIR_MODE,
	},
	{
		home: "agent",
		owner: "package",
		name: "plans/",
		holds: "one plan store per repository, a file per plan",
		written: ["plan"],
		mode: DIR_MODE,
	},
	{
		home: "agent",
		owner: "package",
		name: "jobs/",
		holds: "a job's registry and its log",
		written: ["job"],
		mode: DIR_MODE,
	},
	{
		home: "agent",
		owner: "package",
		name: "wechat/",
		holds: "the bridge's credentials, cursor and media",
		written: ["wechat"],
		mode: DIR_MODE,
	},
	{
		home: "agent",
		owner: "package",
		name: "bytefly/",
		holds: "the update check's cached answer",
		written: ["bytefly"],
	},
];

/**
 * Create a directory a store owns, and narrow one that is already there.
 *
 * `mkdir` applies the mode to what it creates and a umask can only narrow it, so a fresh store is
 * owner-only either way. An install from before this policy has a 0755 directory, and the `chmod`
 * is what makes the mode true of it: the mode is re-stated on every write rather than swept once,
 * because a store nobody writes stays where it is and a store somebody writes is the moment the
 * mode matters.
 */
export function ensurePrivateDir(dir: string): void {
	mkdirSync(dir, { recursive: true, mode: DIR_MODE });
	tightenMode(dir, DIR_MODE);
}

/**
 * Narrow an existing path to `mode`, when it is not already there.
 *
 * The other half of {@link ensurePrivateDir}, and the whole answer for a file: an append keeps the
 * mode the file was created with, so a note store written by hand and a log a child's shell opened
 * are where a wider mode survives a policy that only states itself at creation.
 */
export function tightenMode(path: string, mode: number = FILE_MODE): void {
	try {
		if ((statSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
	} catch {
		// Missing is the ordinary answer: a caller tightens after a write it just made, and a path
		// that is not there has no mode to narrow.
	}
}
