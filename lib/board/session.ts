/**
 * What a board call works on, and who it writes as.
 *
 * One store per working directory, opened on first use and kept for the session:
 * a tool call is frequent and the repository lookup shells out to git, so the
 * answer is remembered per `cwd`. The identity is the same pair a card records — the
 * session id Pi knows, and the team name derived from it — which is why the board can
 * name its owner without reading the bus, and why the name survives a rename.
 *
 * One session per *host*, not one per extension: Pi loads `board` and `team` with
 * separate module caches, so two sessions would mean the seat `/board` sets is
 * invisible to every write `team` makes, and one session would name its own cards
 * two ways.
 *
 * The store and its cache live in this closure, not in a module variable: Pi loads
 * each extension with an isolated module cache, so module state would be one copy
 * per extension and none of them the same one.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { agentLabel, defaultLabel, sessionNameOf } from "../session-label.ts";
import { BUS_DIR_NAME } from "../session-roster.ts";
import type { JoinResult } from "../session-tool.ts";
import type { Actor } from "./rules.ts";
import { type BoardStore, openBoard } from "./store.ts";

/**
 * Where this session stands on the team, as the one place that keeps it.
 *
 * Two surfaces ask: `board` when it joins on the page or on a claim, and `team` for
 * `/team join`. It is a standing rather than a flag because both need to *say* what
 * happened — `/board status` names the label and whether mail is listened for — and
 * because a failure has to be asked again while a success must not be. A failure is
 * kept so a line can say why, and `ok` is what a caller reads to decide.
 */
export interface TeamStanding {
	/** What the last join did, or undefined when this session has not asked. */
	last(): JoinResult | undefined;
	/** Record what an attempt did; a failed one is kept, and asked again. */
	record(result: JoinResult): void;
}

/** What a tool, a page, and a round need from the session, without any of them owning it. */
export interface BoardSession {
	/** The board for `cwd`'s repository. */
	store(cwd: string): Promise<BoardStore>;
	/**
	 * The session a write is made as: its team name, and the id a card keeps.
	 *
	 * The label is the seat while this session serves the page, else `team-agent-<id>`,
	 * else — on a host that reports no id — the readable chain. One name on every
	 * surface is the point: the card, the bus record, and the roster say the same word.
	 */
	who(ctx: ExtensionContext, cwd: string): Actor;
	/** The clock, so a test drives a deadline instead of waiting on one. */
	now(): number;
	/**
	 * Where this repository's session bus files its records, for the roster.
	 *
	 * A path, not a dependency: the board reads those files when they are there and
	 * behaves exactly as before when they are not, which is what keeps the page working
	 * with `session-bus` unloaded. Two callers read it — the page's snapshot, and the
	 * lead's round — and both want the same directory.
	 */
	busDir(cwd: string): Promise<string>;
	/** The seat this session serves the page as, or undefined when it is not serving. */
	serving(): string | undefined;
	/** Serve the page under `seat`, or stand it down when the page stops. */
	serve(seat: string | undefined): void;
	/** Where this session stands on the team, so a claim joins once and status can say. */
	team: TeamStanding;
}

/**
 * The part of a session a command needs: what it is called, and where it stands.
 *
 * `/board` joins, sets the seat, and reports the standing; it never opens a store or
 * reads the bus, so a command takes this much and no more. A test drives it with four
 * stand-ins instead of a whole session with a temp agent directory.
 */
export type BoardTeam = Pick<BoardSession, "who" | "serving" | "serve" | "team">;

/** Test seams and the one place a caller may redirect the store. */
export interface BoardSessionOptions {
	now?: () => number;
	agentDir?: string;
}

/**
 * Where this repository's session bus files its records.
 *
 * The board's store carries the repository key and `session-bus` files under the same one
 * — `join(getAgentDir(), BUS_DIR_NAME, repo.key)` in `session-bus/runtime.ts` — so the two
 * name one directory from one fact. A key read back off the board's own path would make
 * the board's directory layout load-bearing for the roster, and regrouping those files
 * would leave every peer reading as no record at all. It takes the key and nothing else,
 * so there is no directory here to read one off.
 */
export function busDirFor(agentDir: string, store: Pick<BoardStore, "key">): string {
	return join(agentDir, BUS_DIR_NAME, store.key);
}

/**
 * The key one host's session is kept under.
 *
 * `Symbol.for` is the global registry, so the copy of this module in `board`'s cache
 * and the copy in `team`'s agree on the key — a plain `Symbol()` would be two keys on
 * one host, which is the drift this reuse exists to stop.
 */
const SESSION_KEY = Symbol.for("@gavin-hu/my-pi-agent/board-session");

/** A host with this module's key on it. */
type BoardHost = ExtensionAPI & { [SESSION_KEY]?: BoardSession };

/**
 * The session around one host, built on the first call and shared after it.
 *
 * `board` and `team` both work on the same store and must name a write as the same
 * session, so the first caller's options are the ones built: a second extension joins
 * the session that exists rather than opening a second one beside it.
 */
export function openBoardSession(pi: ExtensionAPI, options: BoardSessionOptions = {}): BoardSession {
	const host = pi as BoardHost;
	const shared = host[SESSION_KEY];
	if (shared !== undefined) return shared;
	const stores = new Map<string, Promise<BoardStore>>();
	const busDirs = new Map<string, Promise<string>>();
	let seat: string | undefined;
	let standing: JoinResult | undefined;
	const agentDir = options.agentDir;
	const session: BoardSession = {
		store(cwd) {
			const cached = stores.get(cwd);
			if (cached) return cached;
			const opened = openBoard(pi, cwd, agentDir === undefined ? {} : { agentDir });
			stores.set(cwd, opened);
			return opened;
		},
		who(ctx, cwd) {
			const id = sessionIdOf(ctx);
			// The seat is a role and the agent name is derived from the id, so neither moves
			// when a user renames the session — which is what keeps a card's owner readable
			// against the roster a year later. A host that reports no id has nothing to derive
			// from, so it keeps the bus's own readable chain.
			const label = seat ?? (id === undefined ? defaultLabel(sessionNameOf(ctx), cwd) : agentLabel(id));
			return id === undefined ? { label } : { id, label };
		},
		now: options.now ?? Date.now,
		busDir(cwd) {
			const cached = busDirs.get(cwd);
			if (cached) return cached;
			const resolved = session.store(cwd).then((store) => busDirFor(agentDir ?? getAgentDir(), store));
			busDirs.set(cwd, resolved);
			return resolved;
		},
		serving: () => seat,
		serve: (label) => {
			seat = label;
		},
		team: {
			last: () => standing,
			record: (result) => {
				standing = result;
			},
		},
	};
	host[SESSION_KEY] = session;
	return session;
}

/** The session id, or undefined when the host does not report one. */
function sessionIdOf(ctx: ExtensionContext): string | undefined {
	try {
		const id = ctx.sessionManager.getSessionId();
		return typeof id === "string" && id !== "" ? id : undefined;
	} catch {
		return undefined;
	}
}
