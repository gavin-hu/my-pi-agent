/**
 * Session-bus lifecycle and operations.
 *
 * No mode joins on start. A session is invisible until it names itself, or takes
 * an action that makes it addressable (`send`, `claim`, `join`, `watch`), so a
 * subagent or phone peer never joins a team merely because the package loaded,
 * and a fresh terminal session's board is empty. Reading — the board and
 * `status` — never joins: a reader is not a member.
 * The runtime owns the heartbeat, keeps no module-level state, and uses the
 * common git directory so worktrees of one repository share one bus.
 *
 * A wake that arrives while the agent is running is queued and raised by the
 * extension's reporter once the run settles. The watch itself — the poll, the
 * queue, and the reported set — is `mail-watch.ts`; this module supplies one
 * read-only peek and the actions that join.
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { claimPathMessage, resolveClaimPaths } from "./resolve.ts";
import { realPathOfNearest } from "../../lib/path.ts";
import { SESSION_LABEL_CHANNEL } from "../../lib/session-label.ts";
import { unaccountedMail } from "../../lib/session-mail.ts";
import { defaultInterval } from "../../lib/timer.ts";
import {
	MAX_LABEL,
	MAX_LIMIT,
	normalizeKind,
	normalizeLabel,
	normalizeLimit,
	normalizePaths,
	normalizeText,
	resolveRecipients,
	sessionMode,
	shortId,
} from "./protocol.ts";
import { createMailWatch } from "./mail-watch.ts";
import { createTurn } from "./presence.ts";
import { createBusStore, releaseClaimed, type BusStore } from "./store.ts";
import type { InboxPeek, SessionRecord, SessionStatus } from "./types.ts";
import {
	BUS_DIR_NAME,
	type RosterSeams,
	type RosterState,
	rosterStateOf,
	SESSION_TTL_MS,
} from "../../lib/session-roster.ts";
import { isPidAlive, startTokenOf } from "../../lib/spawn.ts";

import type { SessionBus, SessionBusOptions } from "./api.ts";

export type { SessionBus, SessionBusOptions };

const DEFAULT_HEARTBEAT_MS = 10_000;
const NO_MAIL: InboxPeek = { mail: [], unread: new Set(), unreadable: [] };
const DEFAULT_WATCH_MS = 2_000;
const DEFAULT_MESSAGE_TTL_MS = 24 * 60 * 60_000;
function messageId(now: number): string {
	return `${now}-${randomBytes(4).toString("hex")}`;
}

/** A label with this session's short id appended, inside the label budget. */
function suffixLabel(label: string, id: string): string {
	const suffix = `-${shortId(id)}`;
	return `${label.slice(0, MAX_LABEL - suffix.length)}${suffix}`;
}

export function createSessionBus(pi: ExtensionAPI, options: SessionBusOptions = {}): SessionBus {
	const now = options.now ?? Date.now;
	const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
	const watchMs = options.watchMs ?? DEFAULT_WATCH_MS;
	const interval = options.interval ?? defaultInterval;
	const pid = options.pid ?? process.pid;
	const seams: RosterSeams = { alive: options.alive ?? isPidAlive, token: options.startTokenFn ?? startTokenOf };

	/**
	 * What one record says about its session.
	 *
	 * The rule is the roster's, not a copy: the bus writes these records and the page
	 * reads them, and a second copy of the heartbeat rule is how a dead session keeps its
	 * label and its claims while the screen already says it is gone.
	 */
	function stateOf(session: SessionRecord, at = now()): RosterState {
		return rosterStateOf(session, at, sessionTtlMs, seams);
	}
	const sessionTtlMs = options.sessionTtlMs ?? SESSION_TTL_MS;
	const messageTtlMs = options.messageTtlMs ?? DEFAULT_MESSAGE_TTL_MS;

	let store: BusStore | undefined;
	let record: SessionRecord | undefined;
	let joined = false;
	let stopHeartbeat: (() => void) | undefined;
	let starting: Promise<void> | undefined;

	/**
	 * The turn: a field on this session's record, written on both edges of a run.
	 *
	 * It reads the closure rather than a copy, so a turn that arrives while the bus is
	 * still starting stamps the record the start was about to write.
	 */
	const turn = createTurn({ store: () => store, record: () => record, joined: () => joined, now });

	/** The watch reads this session's own inbox; nothing is consumed or marked. */
	const mailWatch = createMailWatch({
		peek: async (known): Promise<InboxPeek> =>
			store && record ? store.peek(record.id, { limit: MAX_LIMIT, known }) : NO_MAIL,
		interval,
		watchMs,
	});

	const ensureStarted = async (context: ExtensionContext): Promise<void> => {
		if (starting) return starting;
		starting = (async () => {
			// Canonical once, here: the root git reports is a real path, so an unresolved
			// cwd does not contain the paths a caller resolves against it.
			const cwd = realPathOfNearest(context.cwd);
			// Deferred with the one subprocess it spawns: the repository's identity is asked for
			// once, here, and a session that never joins a bus pays nothing for git.
			const { repoKeyFor } = await import("../../lib/repo-key.ts");
			const repo = options.repo ?? (await repoKeyFor(pi, cwd));
			const dir = options.dir ?? join(getAgentDir(), BUS_DIR_NAME, repo.key);
			store = createBusStore({ dir });
			await store.ensure();
			const id = context.sessionManager.getSessionId();
			const mode = sessionMode(context.mode);
			// Asked once, when the bus starts: a reused pid is settled from the record
			// afterwards, so no heartbeat tick spawns `ps`, and a session that never
			// joins pays nothing in its factory.
			const processToken = (seams.token ?? startTokenOf)(pid);
			// Deferred with the ask it makes: a factory registers, and the label settles at the
			// first addressable action instead.
			const { automaticLabel } = await import("./label.ts");
			const label = await automaticLabel(pi, { context, cwd, id, fromGit: repo.fromGit === true });
			record = {
				id,
				label,
				pid,
				cwd,
				repoRoot: repo.root,
				mode,
				startedAt: now(),
				lastSeen: now(),
				// Asked once, here: a reused pid is settled from the record, not by this session
				// polling `ps` for its own heartbeat.
				...(processToken === undefined ? {} : { startToken: processToken }),
			};
		})();
		try {
			await starting;
		} catch (error) {
			starting = undefined;
			throw error;
		}
	};

	/** The start this session is running or ran; only `start` starts one. */
	function ensureReady(): Promise<void> {
		return starting ?? Promise.resolve();
	}

	async function joinBus(): Promise<void> {
		if (!store || !record) throw new Error("session bus is not started.");
		if (joined) return;
		const used = await takenLabels(store, record.id);
		if (used.has(record.label.toLowerCase())) record.label = suffixLabel(record.label, record.id);
		record.lastSeen = now();
		await store.writeSession(record);
		await settleLabel();
		publishLabel();
		joined = true;
		armHeartbeat();
	}

	/**
	 * Start the heartbeat once, whoever joins: `joinBus` on the first addressable
	 * action, and `rename`, which is a join of its own.
	 */
	function armHeartbeat(): void {
		if (heartbeatMs <= 0 || stopHeartbeat) return;
		stopHeartbeat = interval(heartbeatMs, () => {
			void (async () => {
				if (!record || !store) return;
				record.lastSeen = now();
				await store.writeSession(record);
				// A heartbeat that resumed after a long pause can find its label taken; the
				// tick is where a revived session notices and yields, after its own write.
				if (await settleLabel()) publishLabel();
			})().catch(() => {});
		});
	}

	/** The labels other sessions hold, and the record holding each. */
	async function takenLabels(bus: BusStore, mine: string): Promise<Map<string, SessionRecord>> {
		const sessions = await bus.sessions();
		const taken = new Map<string, SessionRecord>();
		// Every record the bus is still keeping, not only a live one. A label is what a session
		// is addressed by, and `team.lead` is a name whose signature decides whether a card may
		// be executed or finished — so a name stays its taker's while the bus remembers the
		// session, which is the same window `store.prune` keeps the record for. A session that
		// crashed a minute ago therefore holds its name instead of leaving it to whoever joins
		// next.
		//
		// The window is the pruner's own, asked here rather than read off `stateOf`: a record
		// past the TTL holds nothing, because the next read deletes it — and a session that
		// yielded to one would spend its life suffixed by a row that no longer exists.
		const at = now();
		for (const session of sessions) {
			if (session.id !== mine && at - session.lastSeen <= sessionTtlMs) taken.set(session.label.toLowerCase(), session);
		}
		return taken;
	}

	/**
	 * A collision is settled by yielding, never by comparing session ids: a session
	 * that keeps the label does not look again, and two of them can each decide that.
	 * Every writer that observes a rival yields, and the record written last always
	 * observes the other, so a collision ends with two distinct labels.
	 *
	 * Answers whether this call yielded, which is the only thing that can change a label
	 * after it is settled — the heartbeat tick is where that happens.
	 */
	async function settleLabel(): Promise<boolean> {
		if (!store || !record) return false;
		const me = record;
		let yields = 0;
		while (yields < 3 && (await takenLabels(store, me.id)).has(me.label.toLowerCase())) {
			me.label = suffixLabel(me.label, me.id);
			yields += 1;
		}
		if (yields === 0) return false;
		me.lastSeen = now();
		await store.writeSession(me);
		return true;
	}

	/**
	 * Tell the footer what peers address this session by.
	 *
	 * Nothing else can say what a label is: the bus settles it, yields it on a collision, and
	 * gives it to a caller that asked for a name. The footer draws it in place of Pi's own
	 * session name, which the terminal knows but a card, a handoff, and `/team` do not.
	 */
	function publishLabel(): void {
		if (!record) return;
		// A host with no event bus has no listener: the footer it would feed keeps Pi's own name.
		pi.events?.emit(SESSION_LABEL_CHANNEL, { id: record.id, label: record.label });
	}

	/**
	 * What a prune must keep, and what it must let go.
	 *
	 * `live` is who can still answer, and this session is active by definition. `gone` is
	 * who cannot: their rows survive on the heartbeat's clock, but the paths they held are
	 * nobody's, which is the half a lead waits for.
	 */
	async function pruneSets(): Promise<{ live: Set<string>; gone: Set<string> }> {
		if (!store) throw new Error("session bus is not started.");
		const at = now();
		const live = new Set<string>();
		const gone = new Set<string>();
		for (const session of await store.sessions()) {
			const state = stateOf(session, at);
			if (state === "live") live.add(session.id);
			else if (state === "gone") gone.add(session.id);
		}
		if (record) live.add(record.id);
		return { live, gone };
	}

	/**
	 * Forget the sessions the TTL has taken, so a label and the row holding it leave together.
	 *
	 * A label is reserved for the window this keeps, so the claim and the prune are one call:
	 * `prepare` joins first and forgets here, which is what leaves a name free and its row gone
	 * at the same moment — and one label over one session, rather than two a `send` must refuse.
	 */
	async function pruneStale(): Promise<void> {
		if (!store || !record) throw new Error("session bus is not started.");
		// The caller is active by definition; refresh it before pruning so a quiet session
		// that finally calls a tool does not delete its own record.
		record.lastSeen = now();
		await store.writeSession(record);
		const sets = await pruneSets();
		await store.prune({
			now: now(),
			activeIds: sets.live,
			goneIds: sets.gone,
			sessionTtlMs,
			messageTtlMs,
		});
	}

	async function prepare(): Promise<void> {
		// A call that lands while the session's start is still settling waits for it: the channel
		// starts the bus without blocking the reload, so the first tool or command is the reader.
		await ensureReady();
		await joinBus();
		await pruneStale();
	}

	async function currentRecord(): Promise<SessionRecord> {
		await prepare();
		if (!record) throw new Error("session bus is not started.");
		return record;
	}

	function storedPaths(me: SessionRecord, raw: unknown): string[] {
		const normalized = normalizePaths(me.repoRoot, me.cwd, raw);
		if ("error" in normalized) throw new Error(normalized.error);
		const keyed = resolveClaimPaths(me.repoRoot, normalized.paths);
		if ("error" in keyed) throw new Error(claimPathMessage(keyed.error));
		return keyed.paths;
	}

	/** The store, for a closure that cannot see the check its caller made. */
	function requireStore(): BusStore {
		if (store === undefined) throw new Error("session bus is not started.");
		return store;
	}

	async function withUnread(
		rows: readonly SessionRecord[],
	): Promise<Array<SessionRecord & { unread: number; state: RosterState }>> {
		const at = now();
		return Promise.all(
			rows.map(async (session) => ({
				...session,
				unread: (await store?.unread(session.id)) ?? 0,
				state: stateOf(session, at),
			})),
		);
	}

	/**
	 * The bus as it stands, this session's own record included.
	 *
	 * `liveOnly` drops a session whose heartbeat went stale, and the claims of one whose
	 * process is gone, without writing or deleting anything, so a board can read it every
	 * second. A gone session stays listed — a lead needs a face for the paths it still
	 * holds — but its claims are nobody's, so they are not drawn. The prune itself stays
	 * with `prepare()` on the next tool or command call, which is therefore what the
	 * screen's next action sees.
	 */
	async function readStatus(
		me: { id: string; label: string; onBus: boolean },
		liveOnly: boolean,
	): Promise<SessionStatus> {
		if (!store) throw new Error("session bus is not started.");
		const records = await store.sessions();
		const sessions = liveOnly
			? records.filter((session) => session.id === record?.id || stateOf(session) !== "quiet")
			: records;
		const ours = new Set(sessions.filter((session) => stateOf(session) !== "gone").map((session) => session.id));
		const claims = (await store.claims()).filter((claim) => !liveOnly || ours.has(claim.owner));
		// Mail is counted per record, so a pruned record's messages have no row to hang a number on.
		// The ids read here are the *record* ids rather than the live ones: a gone record's mail is
		// still its own, and only a record the bus no longer holds leaves mail unaccounted for.
		const unaccounted = await unaccountedMail(store.dir, new Set(records.map((session) => session.id)));
		return {
			me: { id: me.id, label: me.label },
			onBus: me.onBus,
			sessions: await withUnread(sessions),
			...(unaccounted.length > 0 ? { unaccounted } : {}),
			claims,
			...(mailWatch.state().armed ? { watching: mailWatch.state() } : {}),
		};
	}

	/**
	 * The label's holder as a refusal names it: which session, and what it is now.
	 *
	 * A label held by a record that cannot answer reads as a bug unless the sentence says so —
	 * the name is kept because the bus still remembers the session, and it gives the name back
	 * when the heartbeat ages out and a read prunes the record.
	 */
	function heldBy(holder: SessionRecord): string {
		// Only two states can arrive: `takenLabels` reserves a record inside the TTL the prune
		// goes by, so a holder is live or its process is gone.
		return stateOf(holder) === "gone"
			? `held by session ${holder.id}, which is not running — the bus forgets it when its heartbeat ages out`
			: `already in use by session ${holder.id}`;
	}

	async function rename(label: string): Promise<string> {
		if (!store || !record) throw new Error("session bus is not started.");
		const candidate = normalizeLabel(label, record.label);
		// The bus's own answer to "who has it": the session record, named by its id, because
		// the label it holds is the one the caller just asked for.
		const holder = (await takenLabels(store, record.id)).get(candidate.toLowerCase());
		if (holder) throw new Error(`the label "${candidate}" is ${heldBy(holder)}.`);
		record.label = candidate;
		record.lastSeen = now();
		await store.writeSession(record);
		// A rename that raced another one ends on the label the bus settled on, which
		// is what the caller hands to Pi as this session's name.
		await settleLabel();
		publishLabel();
		joined = true;
		armHeartbeat();
		return record.label;
	}

	return {
		async start(context) {
			await ensureStarted(context);
		},

		async stop() {
			stopHeartbeat?.();
			stopHeartbeat = undefined;
			mailWatch.stop();
			if (store && record && joined) {
				// A `/resume` in a second pane registers the same session id twice; the record
				// names the process that owns it, so this one releases and removes only its
				// own. Releasing unconditionally would strip the survivor of the claims it is
				// still working under.
				const owner = await store.session(record.id).catch(() => undefined);
				if (owner === undefined || owner.pid === pid) {
					await store.releaseAll(record.id).catch(() => {});
					await store.removeSession(record.id).catch(() => {});
				}
			}
			joined = false;
			starting = undefined;
			store = undefined;
			record = undefined;
		},

		// Join, name, and listen as one act. Order matters the way it does everywhere else
		// here: the name is validated by `rename` before a watch is armed, so a refused
		// label leaves both the record and the watch exactly as they were.
		async join(input) {
			const me = await currentRecord();
			const label = input.label === undefined ? me.label : await rename(input.label);
			// `listen: false` is the one way to be on the bus without mail: the record stays,
			// so a peer can still address this session, and only the watch is turned off.
			const watching =
				input.listen === false ? await mailWatch.watch({ stop: true }) : await mailWatch.watch({ wake: input.wake });
			// Written on every join, disarmed included, so a peer reads it from disk instead of
			// asking: `armed: false` is the fact `team` reports as "not listening", and the
			// field's absence is only ever a record older than this line.
			me.watching = { armed: watching.armed, wake: watching.wake };
			await requireStore().writeSession(me);
			return { label, watching };
		},
		wantsWake: () => mailWatch.wantsWake(),
		turnStart: () => turn.start(),
		turnSettled: () => turn.settle(),
		poll: () => mailWatch.poll(),
		pending: () => mailWatch.pending(),
		markReported: (ids) => mailWatch.markReported(ids),
		set onWake(callback: (() => void) | undefined) {
			mailWatch.onWake = callback;
		},

		async status() {
			if (!store || !record) throw new Error("session bus is not started.");
			// A reader does not join: an unjoined session prunes and reads, and is not
			// listed by the act of looking. Only an addressable action joins.
			if (!joined) {
				const sets = await pruneSets();
				await store.prune({
					now: now(),
					activeIds: sets.live,
					goneIds: sets.gone,
					sessionTtlMs,
					messageTtlMs,
				});
				return readStatus({ id: record.id, label: record.label, onBus: false }, false);
			}
			const me = await currentRecord();
			return readStatus({ id: me.id, label: me.label, onBus: true }, false);
		},

		async snapshot() {
			if (!store || !record) throw new Error("session bus is not started.");
			return readStatus({ id: record.id, label: record.label, onBus: joined }, true);
		},

		async peek() {
			if (!store || !record) throw new Error("session bus is not started.");
			return store.peek(record.id, { limit: MAX_LIMIT });
		},

		async unread() {
			if (!store || !record) throw new Error("session bus is not started.");
			return store.unread(record.id);
		},
		/**
		 * Clear unaccounted mail — the store's one write, reached only from `/sessions drop`.
		 *
		 * A passthrough with a start check: the store owns both the inbox files and the record set the
		 * attribution is read from, and that read has to happen at the delete so a resume cannot slip
		 * between a listing and a removal.
		 */
		async dropUnaccounted(ids) {
			return requireStore().dropUnaccounted(ids);
		},
		/**
		 * Release a claim by its stored path.
		 *
		 * No normalization: a claim is stored relative to the repo root of the
		 * session that took it, and resolving it again against a cwd below that root
		 * would rewrite the target (`src/api` becomes `src/src/api`). The path comes
		 * from the store and `releaseOne` still refuses a claim owned by someone
		 * else, so this cannot touch a peer's claim.
		 */
		async releaseStored(path) {
			if (!store || !record) throw new Error("session bus is not started.");
			return store.release(path, record.id);
		},

		async send(input) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const text = normalizeText(input.text);
			if ("error" in text) throw new Error(text.error);
			const kind = normalizeKind(input.kind);
			if (input.to.trim() === "*" && kind !== "event") throw new Error('a broadcast needs kind: "event".');
			// Mail reaches a session that can still answer, by the rule `status` and the prune
			// already use: a record whose process is gone is not a recipient, so naming it is
			// refused instead of confirmed, and a broadcast skips it. This session is always its
			// own recipient, which is what a note to itself is.
			const at = now();
			const sessions = (await store.sessions()).filter(
				(session) => session.id === me.id || stateOf(session, at) !== "gone",
			);
			const resolved = resolveRecipients(sessions, input.to, me.id);
			if ("error" in resolved) throw new Error(resolved.error);
			let paths: string[] | undefined;
			if (input.paths !== undefined) paths = storedPaths(me, input.paths);
			const id = messageId(now());
			// One file per inbox, so the peers written before a failure keep the message: the store
			// answers with both lists and the caller decides what a partial delivery means.
			const { delivered, failed } = await store.writeTo(resolved.recipients, {
				id,
				from: me.id,
				fromLabel: me.label,
				kind,
				text: text.text,
				...(paths ? { paths } : {}),
				at: now(),
			});
			return { delivered, failed, messageId: id };
		},

		async inbox(limit) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const { messages } = await store.inbox(me.id, normalizeLimit(limit));
			// Mail read before its notice fired is never announced afterwards.
			mailWatch.markReported(messages.map((message) => message.id));
			return messages;
		},

		async claim(rawPaths) {
			const me = await currentRecord();
			return requireStore().claimAll(storedPaths(me, rawPaths), me.id, me.label, now());
		},

		async release(rawPaths) {
			const me = await currentRecord();
			const bus = requireStore();
			return releaseClaimed(storedPaths(me, rawPaths), (path) => bus.release(path, me.id));
		},
	};
}
