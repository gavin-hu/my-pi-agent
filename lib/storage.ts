/**
 * Every path this package reserves, in both homes, and the mode each one is made with.
 *
 * One table, because the question it answers is one question: *is this name ours, and if so who
 * writes it?* The docs have always listed the project's `.pi` names — this package's and Pi's
 * together — and the agent directory had no such list at all, which is how `.pi/agents` came to
 * claim `subagent` wrote it while the subagent only reads a trusted directory.
 *
 * The mode is here rather than at each store so a reader can see the policy in one place; the
 * helpers that *apply* it live in `lib/json.ts`, beside the writer that creates the directories,
 * because every entry already pays for that module and a second one would be one more module
 * evaluated at every start (`test/dependencies.test.ts`).
 *
 * Data only: no module-level state, and no I/O. `test/boundaries.test.ts` holds the first half and
 * the drift case in `test/drift.test.ts` holds this table against the docs in both directions, so a
 * path named in one and not the other cannot ship.
 */

import { DIR_MODE, FILE_MODE } from "./json.ts";

/** Where a reserved path is filed: the project's `.pi`, or Pi's agent directory. */
export type StorageHome = "project" | "agent";

/** Whose path it is: this package's, Pi's own, or a directory a person fills. */
export type StorageOwner = "package" | "pi" | "you";

/** One path this package reserves, and how it is made. */
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
		name: "presence/",
		holds: "one board's write lock, per repository identity",
		written: ["board"],
		mode: DIR_MODE,
	},
	{
		home: "agent",
		owner: "package",
		name: "repos/",
		holds: "one directory per repository: its board, plans, session-bus, jobs, memory store and worktree registry",
		written: ["board", "plan", "session-bus", "memory", "worktree"],
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
