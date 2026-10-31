/**
 * What a board call works on, and who it writes as.
 *
 * One store per working directory, opened on first use and kept for the session:
 * a tool call is frequent and the repository lookup shells out to git, so the
 * answer is remembered per `cwd`. A failed open is not: one bad read must not
 * outlive the call that hit it, so the next call asks again. The identity is the
 * same pair a card records — the session id Pi knows, and the name the team
 * addresses it by — so the id is what keeps a card held across a rename, and the
 * name is read from the bus record where it is.
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
import { resolveEffectiveCwd } from "../env.ts";
import { plansDirFor } from "../plans/paths.ts";
import { repoKeyFor } from "../repo-key.ts";
import { agentLabel, defaultLabel, normalizeLabel, presetNameFor, sessionNameOf } from "../session-label.ts";
import { BUS_DIR_NAME, readRoster, type RosterSession, rosterStateOf } from "../session-roster.ts";
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
	/**
	 * The board for `cwd`'s repository.
	 *
	 * Opened once and kept, unless the open failed: a rejection is dropped so the next call
	 * asks again, the rule `lib/lazy.ts` states for a load it owns.
	 */
	store(cwd: string): Promise<BoardStore>;
	/**
	 * The session a write is made as: its team name, and the id a card keeps.
	 *
	 * Three answers, in order: the seat while this session serves the page; else the name
	 * the bus already records for it, so `/team join core-claims` is what its cards and
	 * its notes carry and a claim does not rename it back; else a preset teammate name
	 * drawn from the id, or `team-agent-<id>` once every preset name is held by a live
	 * peer. A host that reports no id has no record to read, so it keeps the readable
	 * chain instead. One name on every surface is the point: the card, the bus record,
	 * and the roster say the same word.
	 *
	 * Read rather than remembered, because a join is not this session's event alone: the
	 * label can arrive through `/team join`, through the bus's own `join`, or on the record
	 * a `/resume` inherits, and a name cached at `session_start` would miss all three.
	 */
	who(ctx: ExtensionContext, cwd: string): Promise<Actor>;
	/** The clock, so a test drives a deadline instead of waiting on one. */
	now(): number;
	/**
	 * Where this repository's session bus files its records, for the roster.
	 *
	 * A path, not a dependency: the board reads those files when they are there and
	 * behaves exactly as before when they are not, which is what keeps the page working
	 * with `session-bus` unloaded. Three callers read it — the page's snapshot, `/team`'s
	 * round, and the tool's rollup, which folds the owners a bus has no record of — and all
	 * of them want the same directory. Resolved once per working directory, and asked again
	 * when the store it needs failed, because a failure is no more this cache's to keep.
	 */
	busDir(cwd: string): Promise<string>;
	/**
	 * This repository's plan store, where a card's plan file has to live.
	 *
	 * The board records the artifact a card is executed against, so it has to answer the
	 * question `plan` answers: which directory that store is. One key rule — `repoKeyFor`
	 * over the effective cwd — and the unkeyed branch outside a repository, so a card cannot
	 * name a plan the plan tool would refuse to read. Resolved once per working directory,
	 * with a failed resolution as unremembered as a failed store.
	 */
	planDir(cwd: string): Promise<string>;
	/** The seat this session serves the page as, or undefined when it is not serving. */
	serving(): string | undefined;
	/** Serve the page under `seat`, or stand it down when the page stops. */
	serve(seat: string | undefined): void;
	/** Where this session stands on the team, so a claim joins once and status can say. */
	team: TeamStanding;
}

/** Test seams and the one place a caller may redirect the store. */
export interface BoardSessionOptions {
	now?: () => number;
	agentDir?: string;
	/**
	 * Test seam: the store open itself, so a suite can fail one and watch the next call ask
	 * again. The product supplies nothing, and `store` is the only caller.
	 */
	open?: (cwd: string) => Promise<BoardStore>;
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
 * The labels live peers other than `id` hold, lowercased: the names a draw must skip.
 *
 * The bus's own rule, not a stricter one: a quiet or crashed record's label is free at
 * join, so it is free to draw too, and a repository's history cannot use the pool up.
 */
function liveLabels(roster: readonly RosterSession[] | undefined, id: string, now: number): Set<string> {
	const held = new Set<string>();
	for (const record of roster ?? []) {
		if (record.id !== id && rosterStateOf(record, now) === "live") held.add(record.label.toLowerCase());
	}
	return held;
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
 * One load per key, remembered once it has settled — a rejection is not.
 *
 * A keyed cache is what the three stores below need: two callers on one directory share one
 * promise, so the second call neither opens a second store nor shells out to git again. What
 * must not be shared is a failure — a config read or the agent directory can fail once and
 * answer the next time — so the entry is dropped in its rejection handler, and `lib/lazy.ts`
 * is the same rule for a load with no key.
 */
function rememberLoad<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
	const cached = cache.get(key);
	if (cached !== undefined) return cached;
	const pending = Promise.resolve()
		.then(load)
		.catch((error: unknown) => {
			// The entry is this attempt's: a key is only written when absent, so dropping it
			// cannot drop a newer attempt.
			cache.delete(key);
			throw error;
		});
	cache.set(key, pending);
	return pending;
}

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
	const planDirs = new Map<string, Promise<string>>();
	let seat: string | undefined;
	let standing: JoinResult | undefined;
	const agentDir = options.agentDir;
	/** The real open, unless a suite supplied one: the store a call works on. */
	const open = options.open ?? ((cwd: string) => openBoard(pi, cwd, agentDir === undefined ? {} : { agentDir }));
	const session: BoardSession = {
		store(cwd) {
			return rememberLoad(stores, cwd, () => open(cwd));
		},
		async who(ctx, cwd) {
			const id = sessionIdOf(ctx);
			// The seat is a role rather than a session, so it outranks the record: the page a
			// session serves is the name its cards are read against. A host that reports no id
			// has no record to look for, so it keeps the bus's own readable chain.
			if (seat !== undefined) return id === undefined ? { label: seat } : { id, label: seat };
			if (id === undefined) return { label: defaultLabel(sessionNameOf(ctx), cwd) };
			// The record is the bus's word for this session, so it is read rather than derived;
			// a record that names nothing is no record, and draws like one.
			const roster = await readRoster(await session.busDir(cwd));
			const held = normalizeLabel(roster?.find((entry) => entry.id === id)?.label, "");
			if (held !== "") return { id, label: held };
			// No record, so the team gives this session a preset name: the one its id draws,
			// walked past the names a live peer holds. The fallback keeps a unique name for the
			// day the whole list is taken, so two sessions cannot settle on one word.
			const drawn = presetNameFor(id, liveLabels(roster, id, session.now()));
			return { id, label: drawn ?? agentLabel(id) };
		},
		now: options.now ?? Date.now,
		busDir(cwd) {
			return rememberLoad(busDirs, cwd, () =>
				session.store(cwd).then((store) => busDirFor(agentDir ?? getAgentDir(), store)),
			);
		},
		planDir(cwd) {
			return rememberLoad(planDirs, cwd, () =>
				repoKeyFor(pi, resolveEffectiveCwd(cwd)).then((repo) => plansDirFor(agentDir ?? getAgentDir(), repo)),
			);
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
