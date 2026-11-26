/**
 * What a board call works on, and who it writes as.
 *
 * One store per working directory, opened on first use and kept for the session:
 * a tool call is frequent and the repository lookup shells out to git, so the
 * answer is remembered per `cwd`. A failed open is not: one bad read must not
 * outlive the call that hit it, so the next call asks again. The identity is the
 * same pair a card records — the session id Pi knows, and the name the team
 * addresses it by — so the id is what keeps a card held across a rename and across a
 * transcript reset, and the name is read from the bus record where it is. The record is
 * read as *this process's* too: a `/new` keeps it, so the id its cards are owned by is
 * the one the row carries and not the one the new transcript was handed.
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

import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../env.ts";
import { PLANS_DIR_NAME } from "../plans/paths.ts";
import type { HostIdentity } from "../session-files.ts";
import { agentLabel, defaultLabel, labelKey, normalizeLabel, sessionIdOf, sessionNameOf } from "../session-label.ts";
import { presenceOf, type RosterSession, readRoster, readTeam, type TeamRead } from "../session-roster.ts";
import type { JoinResult } from "../session-tool.ts";
import { type Card, normalizeCardId } from "./card.ts";
import type { Claims } from "./claims.ts";
import { liveLabelOf } from "./round-text.ts";
import type { HolderFact } from "./signs.ts";
import type { Actor } from "./rules.ts";
import { type BoardStore, type MutateResult, openBoard } from "./store.ts";

/**
 * Where this session stands on the team, as the one place that keeps it.
 *
 * Two surfaces ask: `board` when it joins on the page or on a claim, and `team` for
 * `/team join`. It is a standing rather than a flag because both need to *say* what
 * happened — `/board status` names the label and whether mail is listened for — and
 * because the next ask reads more than the last answer: a failure is asked again, and so
 * is a success the bus no longer holds, which is the roster half in `lib/workflow/join.ts`.
 * A failure is kept so a line can say why, and `ok` is what a caller reads to decide.
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
	 * Four answers, in order: the seat while this session serves the page; else the name the bus
	 * already records for it, so `/team join core-claims` is what its cards and its notes carry and
	 * a claim does not rename it back; else the first name `team.teammates` lists that nobody else
	 * holds — a project's own, or the loader's default five; else `team-agent-<id>`, which cannot
	 * collide and cannot drift on a rename. A host that reports no id has no record to
	 * read, so it keeps the readable chain instead. One name on every surface is the point: the
	 * card, the bus record, and the roster say the same word.
	 *
	 * The record looked at is two rows, the id's first: the one this session id names, and the one
	 * this *process* serves — a `/new` keeps it, so the id its cards are owned by is the row's and not
	 * the one the new transcript was handed (#915). A row from another machine is neither: its pid
	 * is a number that may coincide, so the read asks which machine wrote it.
	 *
	 * Read rather than remembered, because a join is not this session's event alone: the
	 * label can arrive through `/team join`, through the bus's own `join`, or on the record
	 * a `/resume` inherits, and a name cached at `session_start` would miss all three.
	 */
	who(ctx: ExtensionContext, cwd: string): Promise<Actor>;
	/** The clock, so a test drives a deadline instead of waiting on one. */
	now(): number;
	/**
	 * Where this repository's session bus files its records.
	 *
	 * A path, not a dependency: the board reads those files when they are there and
	 * behaves exactly as before when they are not, which is what keeps the page working
	 * with `session-bus` unloaded. Resolved once per working directory, and asked again
	 * when the store it needs failed, because a failure is no more this cache's to keep.
	 */
	busDir(cwd: string): Promise<string>;
	/**
	 * Every session the bus has recorded for this repository, or `undefined` when it has
	 * never recorded one here — read as data, so the board works with `session-bus`
	 * unloaded.
	 *
	 * One method rather than a `busDir` call at each reader: `who` asks it for a label, the
	 * join asks it whether the bus still holds this session, the rollup folds the owners a
	 * bus has no record of, and `/team` prints who is here — so the directory is built in
	 * one place and every caller renders the same answer. Never cached: a heartbeat is ten
	 * seconds old at most, and a caller polls on its own clock.
	 *
	 * A `busDir` that fails is not swallowed here; the caller that cannot report a failure
	 * is the caller that catches it.
	 */
	roster(cwd: string): Promise<RosterSession[] | undefined>;
	/**
	 * The roster and the waiting queue from one pass over the bus.
	 *
	 * A page draws both, and both come from the same inboxes: the queue used to be a second walk of
	 * every inbox after the roster's own count, once a second, for as long as a tab was open. The
	 * board reads this instead of the two readers, and `roster` stays for the callers that want only
	 * the names — a note's audience, `/team`'s listing, the join's own check.
	 */
	bus(cwd: string): Promise<TeamRead>;
	/**
	 * What the bus says about the session holding `card`, bound to the owner it is about.
	 *
	 * The one question a board rule asks outside the card, built here because the roster is this
	 * session's: `undefined` is "cannot tell" — no bus here, or a read that failed — and a caller
	 * that cannot report that failure is the caller that catches it.
	 */
	holder(cwd: string, card: Card): Promise<HolderFact | undefined>;
	/**
	 * The name the bus shows for the holder of the card a call names, or undefined when it cannot say.
	 *
	 * The sibling of {@link holder} for the half a sentence reads: a card records the label its claim
	 * captured, and a session renamed since leaves that record holding a name nobody answers to. The
	 * roster is the one a listing maps its rows through (`liveLabelOf`), so there is no second chain,
	 * and `raw` is the caller's own spelling because the id is its argument rather than this read's.
	 *
	 * An empty name is no answer either: `heldBy` prints the id when even the record has none, and a
	 * caller handed `""` would print an empty name instead. A bus that cannot answer leaves the
	 * sentence as it is, which is why every read here is caught rather than raised.
	 */
	holderLabel(cwd: string, raw: string | undefined): Promise<string | undefined>;
	/**
	 * This repository's plan store, where a card's plan file has to live.
	 *
	 * The board records the artifact a card is executed against, so it has to answer the
	 * question `plan` answers: which directory that store is. The answer is the sibling of the
	 * board store this session resolved — one repository's state is one directory (#771) — which
	 * is the rule {@link busDirFor} states for the bus and the one that keeps a plan the tool
	 * just wrote contractible. Resolved once per working directory, with a failed resolution as
	 * unremembered as a failed store.
	 */
	planDir(cwd: string): Promise<string>;
	/**
	 * This machine's host id, from the agent directory's `presence/host.json`.
	 *
	 * The board draws which sessions are elsewhere and which machines are awake, and both questions
	 * start here: the identity names this machine, so the other machine's records are the ones that
	 * do not carry it. `undefined` is a machine no session here has joined from yet — a miss is not
	 * remembered, because the bus makes the file on its first join and a page that cached the
	 * absence would read its own records as another machine's until it restarted.
	 */
	host(): Promise<string | undefined>;
	/** The seat this session serves the page as, or undefined when it is not serving. */
	serving(): string | undefined;
	/** Serve the page under `seat`, or stand it down when the page stops. */
	serve(seat: string | undefined): void;
	/** Where this session stands on the team, so a claim joins and `/board status` can say. */
	team: TeamStanding;
	/**
	 * What one write's lane crossing claimed or released, as a clause for the result.
	 *
	 * Here rather than in a tool because two doors cross a lane — the board's `move`, `release`,
	 * `reclaim` and `drop`, and the round's `reclaim` — and a crossing is the one write whose
	 * side effect is the bus's. `undefined` is the ordinary answer: the write stayed in its
	 * lane, the card names no paths, or nobody is listening. The rule itself is
	 * `claims.ts`'s, loaded on the first crossing so a session that never moves a card pays
	 * nothing for it.
	 */
	cross(ctx: ExtensionContext, result: MutateResult): Promise<string | undefined>;
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
	/** Test seam: the bus a lane crossing writes to, so a suite records it without a bus. */
	claims?: Claims;
	/** Test seam: the process whose bus record this session serves, so a suite drives a `/new`. */
	pid?: number;
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
 *
 * The bus's directory name is loaded here rather than imported at the top of the module: this
 * file is registered by `board` and `team`, and a static import of `lib/session-files.ts` put the
 * whole file layer in both their graphs. Every caller already awaits this — `session.busDir` is a
 * promise — so the `import()` costs the first call and nothing else, and Node caches the module.
 */
export async function busDirFor(_agentDir: string, store: Pick<BoardStore, "dir">): Promise<string> {
	const { BUS_DIR_NAME } = await import("../session-files.ts");
	// Beside the board rather than beside the agent directory: one repository's state is one
	// directory now, so the bus is a sibling of `board/` under `repos/<id>/` and cannot drift from
	// the store it belongs to. The argument stays for its callers, which pass the agent directory.
	return join(dirname(store.dir), BUS_DIR_NAME);
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
 * The first name a team lists that nobody holds, or `fallback` when it lists none.
 *
 * `taken` holds label keys, not labels: a name is addressed without case wherever it is compared,
 * so a caller that keyed them itself would be the second place that rule is written.
 */
function firstFreeName(teammates: readonly string[], taken: readonly string[], fallback: string): string {
	return teammates.find((name) => !taken.includes(labelKey(name))) ?? fallback;
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
	// Filed by the cwd rather than the root, unlike the stores above: a bus directory and a plan
	// directory are repository identity (`dirname(store.dir)`), so one repository's two roots answer
	// one directory — only a store's `root()` moves with the worktree.
	const busDirs = new Map<string, Promise<string>>();
	const planDirs = new Map<string, Promise<string>>();
	let seat: string | undefined;
	/** This machine's identity, once one is there to read: a miss is asked again, not remembered. */
	let identity: Promise<HostIdentity | undefined> | undefined;
	let standing: JoinResult | undefined;
	// The crossing's rule, loaded on the first lane change: a session that never moves a card pays
	// nothing for it, and the deferral is what keeps both entries' registration graphs where they are.
	let claimsModule: Promise<typeof import("./claims.ts")> | undefined;
	// The seat's reader, deferred for the same reason: `modeOf` is only needed to dress an actor, and
	// a static import here would put `mode-state` in this entry's graph whether or not a card moves.
	let modeState: Promise<typeof import("../mode-state.ts")> | undefined;
	const agentDir = options.agentDir;
	/** The real open, unless a suite supplied one: the store a call works on. */
	const open = options.open ?? ((cwd: string) => openBoard(pi, cwd, agentDir === undefined ? {} : { agentDir }));
	const session: BoardSession = {
		store(cwd) {
			// Keyed by the effective root, not the cwd: entering or leaving a worktree moves
			// `PI_WORKTREE_ROOT`, and `worktreeRoot()` stops answering once the path is gone, so this
			// key follows the exit by itself. Opening under the session cwd pinned the worktree's root
			// for the session's life, and the close after an exit read git in a directory that was gone.
			return rememberLoad(stores, resolveEffectiveCwd(cwd), () => open(cwd));
		},
		async who(ctx, cwd) {
			const id = sessionIdOf(ctx);
			// The seat is lead mode, composed here because this is the one place a session's own answer
			// is built: the two doors a lead has without holding a card — opening `execute` and taking a
			// card back — read it (`leadAuthority`), and a session that serves the page under its own
			// name is a peer at both without it (#825). Deferred and cached in this closure, so a
			// session with no seat pays one load of a small pure module and nothing after that.
			const { holdsSeat } = await (modeState ??= import("../mode-state.ts"));
			const seatHeld = holdsSeat(ctx.sessionManager.getBranch());
			const dressed = (actor: Actor): Actor => (seatHeld ? { ...actor, seat: true } : actor);
			// The record is the bus's word for this session, so it is read rather than derived. Two rows
			// can be this session's: the one its id names — a session that joined before, a `/reload` —
			// and the one this process served before a `/new` replaced the transcript, because a reset
			// keeps the record (#915): a peer addresses it and a card is owned by it. The id row wins,
			// so a session that did not just reset is named exactly as it was.
			//
			// Read here rather than through `session.roster`, which names no machine: a row is only this
			// process's when the pid in it is a *local* pid, and a record from another machine's bus can
			// carry a number that coincides with this one.
			const roster =
				id === undefined ? undefined : await readRoster(await session.busDir(cwd), { host: await session.host() });
			const pid = options.pid ?? process.pid;
			const mine =
				id === undefined
					? undefined
					: (roster?.find((entry) => entry.id === id) ??
						roster?.find((entry) => entry.pid === pid && entry.foreign !== true));
			// The seat is a role rather than a session, so it outranks the record: the page a
			// session serves is the name its cards are read against. A host that reports no id
			// has no record to look for, so it keeps the bus's own readable chain.
			if (seat !== undefined) {
				const seatId = mine?.id ?? id;
				return dressed(seatId === undefined ? { label: seat } : { id: seatId, label: seat });
			}
			if (id === undefined) return dressed({ label: defaultLabel({ sessionName: sessionNameOf(ctx), cwd }) });
			// From here this session has an id, so the record it serves has one too.
			const mineId = mine?.id ?? id;
			// A record that names nothing is no record, and draws like one.
			const held = normalizeLabel(mine?.label, "");
			if (held !== "") return dressed({ id: mineId, label: held });
			// No record, so the team names this session: the first name the list leaves free, and the id's
			// tail only when it leaves none — a stated `[]`, or every name held. The list is the store's
			// because the lead it excludes is the one the gates compare, and the roster above has
			// already opened that store — a failure there is the call's, not the name's.
			const team = (await session.store(cwd)).config();
			const taken = (roster ?? []).filter((entry) => entry.id !== mineId).map((entry) => labelKey(entry.label));
			taken.push(labelKey(team.lead));
			return dressed({ id: mineId, label: firstFreeName(team.teammates, taken, agentLabel(mineId)) });
		},
		now: options.now ?? Date.now,
		busDir(cwd) {
			return rememberLoad(busDirs, cwd, () =>
				session.store(cwd).then((store) => busDirFor(agentDir ?? getAgentDir(), store)),
			);
		},
		async roster(cwd) {
			return readRoster(await session.busDir(cwd));
		},
		async bus(cwd) {
			return readTeam(await session.busDir(cwd));
		},
		async holder(cwd, card) {
			const owner = card.owner;
			if (owner === undefined) return undefined;
			// A bus that cannot be read is not a session that stopped, so the answer stays a question.
			const roster = await session.roster(cwd).catch(() => undefined);
			const state = presenceOf(roster, owner, session.now());
			return state === undefined ? undefined : { owner, state };
		},
		async holderLabel(cwd, raw) {
			const id = raw === undefined ? undefined : normalizeCardId(raw);
			if (id === undefined) return undefined;
			const card = await (await session.store(cwd)).read(id).catch(() => undefined);
			const owner = card?.owner;
			if (owner === undefined) return undefined;
			const roster = await session.roster(cwd).catch(() => undefined);
			const label = roster === undefined ? owner.label : liveLabelOf(owner, roster);
			return label === "" ? undefined : label;
		},
		async host() {
			const found = await (identity ??= import("../session-files.ts").then((module) =>
				module.readHostIdentity(agentDir ?? getAgentDir()),
			));
			if (found === undefined) identity = undefined;
			return found?.id;
		},
		planDir(cwd) {
			return rememberLoad(planDirs, cwd, () =>
				session.store(cwd).then((store) => join(dirname(store.dir), PLANS_DIR_NAME)),
			);
		},
		serving: () => seat,
		serve: (label) => {
			seat = label;
		},
		cross: (ctx, result) =>
			(claimsModule ??= import("./claims.ts")).then((module) =>
				module.holdPaths(options.claims ?? module.busClaims(pi), ctx, result),
			),
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
