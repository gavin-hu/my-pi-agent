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
import { repoKeyFor } from "../../lib/repo-key.ts";
import { sessionNameOf } from "../../lib/session-label.ts";
import { defaultInterval, type RepeatTimer } from "../../lib/timer.ts";
import {
	defaultLabel,
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
import { createBusStore, releaseClaimed, type BusStore } from "./store.ts";
import type { BusMessage, ClaimConflict, SessionRecord, SessionStatus } from "./types.ts";

export interface SessionBusOptions {
	now?: () => number;
	/** Test seam: use this bus directory instead of the agent-dir layout. */
	dir?: string;
	/** Test seam: the process id this runtime registers as, so two can share one session id. */
	pid?: number;
	/** Test seam: skip git and use this repository identity. */
	repo?: { root: string; key: string };
	/** Heartbeat interval; 0 disables it (tests). */
	heartbeatMs?: number;
	/** Inbox-watch poll interval; 0 disables it (tests). */
	watchMs?: number;
	/** Test seam: the repeating timer behind the heartbeat and the poll. */
	interval?: RepeatTimer;
	sessionTtlMs?: number;
	messageTtlMs?: number;
}

export interface SessionBus {
	start(ctx: ExtensionContext): Promise<void>;
	stop(): Promise<void>;
	status(): Promise<SessionStatus>;
	/** The live bus, read only: no record refresh, no prune. */
	snapshot(): Promise<SessionStatus>;
	/** This session's unread mail, read only: nothing is consumed or marked. */
	peek(): Promise<BusMessage[]>;
	/** Release a claim by its stored repository-relative path. */
	releaseStored(path: string): Promise<boolean>;
	send(input: {
		to: string;
		text: string;
		kind?: string;
		paths?: unknown;
	}): Promise<{ delivered: string[]; messageId: string }>;
	inbox(limit?: number): Promise<BusMessage[]>;
	claim(paths: unknown): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }>;
	release(paths: unknown): Promise<{ released: string[]; notOwned: string[] }>;
	rename(label: string): Promise<string>;
	/** Arm or disarm this session's inbox watch. */
	watch(input: { wake?: boolean; stop?: boolean }): Promise<{ armed: boolean; wake: boolean }>;
	/** Whether the armed watch asked for a triggered turn; the settle retry reads it. */
	wantsWake(): boolean;
	/** Read the inbox without consuming it, queueing what is new; no-op when unarmed. */
	poll(): Promise<void> /** Mail that arrived and has not been reported yet, oldest first. */;
	pending(): BusMessage[];
	/** Drop mail from the pending queue, once reported or consumed. */
	markReported(ids: readonly string[]): void;
	/** Set what to call when new mail arrives and this session asked to be woken. */
	set onWake(callback: (() => void) | undefined);
}

const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_WATCH_MS = 2_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60_000;
const DEFAULT_MESSAGE_TTL_MS = 24 * 60 * 60_000;
function messageId(now: number): string {
	return `${now}-${randomBytes(4).toString("hex")}`;
}

/** Whether a record's heartbeat is fresh: the rule the bus prunes and displays by. */
function isLive(session: SessionRecord, at: number, ttlMs: number): boolean {
	return at - session.lastSeen <= ttlMs;
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
	const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
	const messageTtlMs = options.messageTtlMs ?? DEFAULT_MESSAGE_TTL_MS;

	let store: BusStore | undefined;
	let record: SessionRecord | undefined;
	let joined = false;
	let stopHeartbeat: (() => void) | undefined;
	let starting: Promise<void> | undefined;

	/** The watch reads this session's own inbox; nothing is consumed or marked. */
	const mailWatch = createMailWatch({
		peek: async () => (store && record ? store.peek(record.id, MAX_LIMIT) : []),
		interval,
		watchMs,
	});

	const ensureStarted = async (context: ExtensionContext): Promise<void> => {
		if (starting) return starting;
		starting = (async () => {
			// Canonical once, here: the root git reports is a real path, so an unresolved
			// cwd does not contain the paths a caller resolves against it.
			const cwd = realPathOfNearest(context.cwd);
			const repo = options.repo ?? (await repoKeyFor(pi, cwd));
			const dir = options.dir ?? join(getAgentDir(), "session-bus", repo.key);
			store = createBusStore({ dir });
			await store.ensure();
			const id = context.sessionManager.getSessionId();
			const mode = sessionMode(context.mode);
			record = {
				id,
				label: defaultLabel(sessionNameOf(context), cwd, id),
				pid,
				cwd,
				repoRoot: repo.root,
				mode,
				startedAt: now(),
				lastSeen: now(),
			};
		})();
		try {
			await starting;
		} catch (error) {
			starting = undefined;
			throw error;
		}
	};

	async function joinBus(): Promise<void> {
		if (!store || !record) throw new Error("session bus is not started.");
		if (joined) return;
		const used = await takenLabels(store, record.id);
		if (used.has(record.label.toLowerCase())) record.label = suffixLabel(record.label, record.id);
		record.lastSeen = now();
		await store.writeSession(record);
		await settleLabel();
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
				await settleLabel();
			})().catch(() => {});
		});
	}

	/** The labels other live sessions hold: a crashed session's label is not taken. */
	async function takenLabels(bus: BusStore, mine: string): Promise<Set<string>> {
		const at = now();
		const sessions = await bus.sessions();
		return new Set(
			sessions
				.filter((session) => session.id !== mine && isLive(session, at, sessionTtlMs))
				.map((session) => session.label.toLowerCase()),
		);
	}

	/**
	 * A collision is settled by yielding, never by comparing session ids: a session
	 * that keeps the label does not look again, and two of them can each decide that.
	 * Every writer that observes a rival yields, and the record written last always
	 * observes the other, so a collision ends with two distinct labels.
	 */
	async function settleLabel(): Promise<void> {
		if (!store || !record) return;
		const me = record;
		let yields = 0;
		while (yields < 3 && (await takenLabels(store, me.id)).has(me.label.toLowerCase())) {
			me.label = suffixLabel(me.label, me.id);
			yields += 1;
		}
		if (yields === 0) return;
		me.lastSeen = now();
		await store.writeSession(me);
	}

	/** The live session ids a prune must keep: this session is active by definition. */
	async function liveIds(): Promise<Set<string>> {
		if (!store) throw new Error("session bus is not started.");
		const at = now();
		const active = new Set(
			(await store.sessions()).filter((session) => isLive(session, at, sessionTtlMs)).map((session) => session.id),
		);
		if (record) active.add(record.id);
		return active;
	}

	async function prepare(): Promise<void> {
		if (!store || !record) throw new Error("session bus is not started.");
		await joinBus();
		// The caller is active by definition; refresh it before pruning so a quiet
		// session that finally calls a tool does not delete its own record.
		record.lastSeen = now();
		await store.writeSession(record);
		const sessions = await store.sessions();
		const active = new Set(
			sessions.filter((session) => isLive(session, now(), sessionTtlMs)).map((session) => session.id),
		);
		if (record) active.add(record.id);
		await store.prune({ now: now(), activeIds: active, sessionTtlMs, messageTtlMs });
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

	async function withUnread(rows: readonly SessionRecord[]): Promise<Array<SessionRecord & { unread: number }>> {
		return Promise.all(rows.map(async (session) => ({ ...session, unread: (await store?.unread(session.id)) ?? 0 })));
	}

	/**
	 * The bus as it stands, this session's own record included.
	 *
	 * `liveOnly` drops a session whose heartbeat went stale, and a claim held by
	 * one, without writing or deleting anything, so a board can read it every
	 * second. The prune itself stays with `prepare()` on the next tool or command
	 * call, which is therefore what the screen's next action sees.
	 */
	async function readStatus(
		me: { id: string; label: string; onBus: boolean },
		liveOnly: boolean,
	): Promise<SessionStatus> {
		if (!store) throw new Error("session bus is not started.");
		const records = await store.sessions();
		const sessions = liveOnly
			? records.filter((session) => session.id === record?.id || isLive(session, now(), sessionTtlMs))
			: records;
		const live = new Set(sessions.map((session) => session.id));
		const claims = (await store.claims()).filter((claim) => !liveOnly || live.has(claim.owner));
		return {
			me: { id: me.id, label: me.label },
			onBus: me.onBus,
			sessions: await withUnread(sessions),
			claims,
			...(mailWatch.state().armed ? { watching: mailWatch.state() } : {}),
		};
	}

	async function rename(label: string): Promise<string> {
		if (!store || !record) throw new Error("session bus is not started.");
		const candidate = normalizeLabel(label, record.label);
		if ((await takenLabels(store, record.id)).has(candidate.toLowerCase())) {
			throw new Error(`the label "${candidate}" is already in use.`);
		}
		record.label = candidate;
		record.lastSeen = now();
		await store.writeSession(record);
		// A rename that raced another one ends on the label the bus settled on, which
		// is what the caller hands to Pi as this session's name.
		await settleLabel();
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

		async watch(input) {
			// Arming needs an inbox, so it is one of the actions that joins.
			await currentRecord();
			return mailWatch.watch(input);
		},
		wantsWake: () => mailWatch.wantsWake(),
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
				await store.prune({ now: now(), activeIds: await liveIds(), sessionTtlMs, messageTtlMs });
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
			return store.peek(record.id, MAX_LIMIT);
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
			const sessions = await store.sessions();
			const resolved = resolveRecipients(sessions, input.to, me.id);
			if ("error" in resolved) throw new Error(resolved.error);
			let paths: string[] | undefined;
			if (input.paths !== undefined) paths = storedPaths(me, input.paths);
			const id = messageId(now());
			for (const recipient of resolved.recipients) {
				const message: BusMessage = {
					id,
					from: me.id,
					fromLabel: me.label,
					to: recipient.id,
					toLabel: recipient.label,
					kind,
					text: text.text,
					...(paths ? { paths } : {}),
					at: now(),
				};
				await store.writeMessage(recipient.id, message);
			}
			return { delivered: resolved.recipients.map((recipient) => recipient.label), messageId: id };
		},

		async inbox(limit) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const messages = await store.inbox(me.id, normalizeLimit(limit));
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

		rename,
	};
}
