/**
 * Session-bus lifecycle and operations.
 *
 * A terminal session registers on `session_start`. RPC, JSON, print, and WeChat
 * peer sessions stay invisible until they call the tool or `/sessions`, so a
 * subagent or phone peer does not join a team merely because the package loaded.
 * The runtime owns the heartbeat, keeps no module-level state, and uses the
 * common git directory so worktrees of one repository share one bus.
 *
 * An armed inbox watch polls this session's own inbox directory and hands what
 * arrived to the caller's `onWake`, which the extension wires to the shared
 * pending reporter. A wake that arrives while the agent is running is queued and
 * raised by that reporter once the run settles. It announces and never consumes:
 * `inbox` keeps sole ownership of deleting mail, so a wake cannot eat a message
 * the model did not read.
 */

import { randomBytes } from "node:crypto";
import { join, relative, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { isInside, realPathOfNearest } from "../../lib/path.ts";
import { SPLIT_OFF_NOTE, splitEnabled } from "../../lib/plans/setting.ts";
import { plansDir } from "../../lib/plans/store.ts";
import { repoKeyFor } from "../../lib/repo-key.ts";
import { defaultInterval, type RepeatTimer } from "../../lib/timer.ts";
import {
	defaultLabel,
	isAutoJoinMode,
	MAX_LABEL,
	MAX_LIMIT,
	normalizeKind,
	normalizeLabel,
	normalizeLimit,
	normalizePaths,
	normalizeText,
	resolveRecipients,
	sessionMode,
	claimsConflict,
	shortId,
} from "./protocol.ts";
import { createBusStore, type BusStore } from "./store.ts";
import { newestTeam, resolveUnit, unitHolder } from "./team.ts";
import type { BusMessage, ClaimConflict, SessionRecord, SessionStatus } from "./types.ts";

export interface SessionBusOptions {
	now?: () => number;
	/** Test seam: use this bus directory instead of the agent-dir layout. */
	dir?: string;
	/** Test seam: skip git and use this repository identity. */
	repo?: { root: string; key: string };
	/** Test seam: read teams from this plan store instead of the agent-dir layout. */
	plans?: string;
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
	/** Claim every path of one unit in a split plan. */
	join(input: {
		team?: string;
		unit?: string;
	}): Promise<{ team: string; unit: string; claimed: string[]; conflicts: ClaimConflict[] }>;
	/** Release the paths of one unit, or every claim this session holds. */
	leave(input: { team?: string; unit?: string }): Promise<{ released: string[]; notOwned: string[] }>;
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

/**
 * Re-key accepted paths by their real target, so a symlinked spelling inside the
 * repository and the file it names are one claim. The paths arrive relative and
 * already inside the root; a link that leaves it is refused here.
 */
function canonicalPaths(root: string, paths: readonly string[]): { paths: string[] } | { error: string } {
	const realRoot = realPathOfNearest(root);
	const canonical: string[] = [];
	for (const path of paths) {
		const target = realPathOfNearest(join(root, path));
		const rel = relative(realRoot, target);
		if (rel === "" || !isInside(realRoot, target)) {
			return { error: `path "${path}" does not resolve to a file in the repository.` };
		}
		const normalized = rel.split(sep).join("/");
		if (!canonical.includes(normalized)) canonical.push(normalized);
	}
	return { paths: canonical };
}

function sessionName(ctx: ExtensionContext): string | undefined {
	try {
		return ctx.sessionManager.getSessionName();
	} catch {
		return undefined;
	}
}

export function createSessionBus(pi: ExtensionAPI, options: SessionBusOptions = {}): SessionBus {
	const now = options.now ?? Date.now;
	const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
	const watchMs = options.watchMs ?? DEFAULT_WATCH_MS;
	const interval = options.interval ?? defaultInterval;
	const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
	const messageTtlMs = options.messageTtlMs ?? DEFAULT_MESSAGE_TTL_MS;

	let store: BusStore | undefined;
	let plansRoot: string | undefined;
	let record: SessionRecord | undefined;
	let joined = false;
	let stopHeartbeat: (() => void) | undefined;
	let starting: Promise<void> | undefined;

	let armed = false;
	let wake = false;
	let stopTicker: (() => void) | undefined;
	let pendingMail: BusMessage[] = [];
	/** Ids already queued, reported, or consumed; a broadcast shares one id. */
	let reported = new Set<string>();
	let onWake: (() => void) | undefined;

	const ensureStarted = async (context: ExtensionContext): Promise<void> => {
		if (starting) return starting;
		starting = (async () => {
			// Canonical once, here: the root git reports is a real path, so an unresolved
			// cwd does not contain the paths a caller resolves against it.
			const cwd = realPathOfNearest(context.cwd);
			const repo = options.repo ?? (await repoKeyFor(pi, cwd));
			const dir = options.dir ?? join(getAgentDir(), "session-bus", repo.key);
			plansRoot = options.plans ?? plansDir(getAgentDir(), repo.key);
			store = createBusStore({ dir });
			await store.ensure();
			const id = context.sessionManager.getSessionId();
			const mode = sessionMode(context.mode);
			record = {
				id,
				label: defaultLabel(sessionName(context), cwd, id),
				pid: process.pid,
				cwd,
				repoRoot: repo.root,
				mode,
				startedAt: now(),
				lastSeen: now(),
			};
			if (isAutoJoinMode(context.mode)) await joinBus();
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
		if (heartbeatMs > 0) {
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

	/** The stored form of the paths a caller passed: validated, then keyed by target. */
	/**
	 * The stored form of paths a plan wrote relative to the repository.
	 *
	 * A unit's paths are repository-relative by construction, so they resolve
	 * against the repo root and not the session's cwd: a session started in a
	 * subdirectory would otherwise claim `packages/web/src/core` for a unit that
	 * owns `src/core`.
	 */
	function rootedPaths(me: SessionRecord, paths: readonly string[]): string[] {
		const keyed = canonicalPaths(
			me.repoRoot,
			paths.map((path) => path.replace(/^\/+/, "")),
		);
		if ("error" in keyed) throw new Error(keyed.error);
		return keyed.paths;
	}

	function storedPaths(me: SessionRecord, raw: unknown): string[] {
		const normalized = normalizePaths(me.repoRoot, me.cwd, raw);
		if ("error" in normalized) throw new Error(normalized.error);
		const keyed = canonicalPaths(me.repoRoot, normalized.paths);
		if ("error" in keyed) throw new Error(keyed.error);
		return keyed.paths;
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
	async function readStatus(me: { id: string; label: string }, liveOnly: boolean): Promise<SessionStatus> {
		if (!store) throw new Error("session bus is not started.");
		const records = await store.sessions();
		const sessions = liveOnly
			? records.filter((session) => session.id === record?.id || isLive(session, now(), sessionTtlMs))
			: records;
		const live = new Set(sessions.map((session) => session.id));
		const claims = (await store.claims()).filter((claim) => !liveOnly || live.has(claim.owner));
		// The team line is a file read plus a claim scan, so the board's repaint does
		// not pay for it: only an explicit status call reports units.
		const board = liveOnly || plansRoot === undefined ? undefined : newestTeam(plansRoot);
		const units =
			board === undefined
				? undefined
				: {
						team: board.team,
						joined: board.units.filter((unit) => unitHolder(unit, claims, claimsConflict) !== undefined).length,
						total: board.units.length,
						rows: board.units.map((unit) => {
							const holder = unitHolder(unit, claims, claimsConflict);
							return {
								unit: unit.name,
								...(unit.lead ? { lead: true } : {}),
								...(holder === undefined ? {} : { holder }),
							};
						}),
					};
		return {
			me,
			sessions: await withUnread(sessions),
			claims,
			...(units ? { units } : {}),
			...(armed ? { watching: { armed, wake } } : {}),
		};
	}

	function dropFromPending(ids: ReadonlySet<string>): void {
		pendingMail = pendingMail.filter((message) => !ids.has(message.id));
	}

	function markReported(ids: readonly string[]): void {
		for (const id of ids) reported.add(id);
		dropFromPending(new Set(ids));
	}

	/**
	 * Queue what arrived since the last poll, once, and wake a turn when this
	 * session asked for one.
	 *
	 * The reported set is narrowed to the mail still on disk, so it is bounded by
	 * the unread count rather than by the session's whole history; an id is unique
	 * for good, so a message that was consumed can never be queued again.
	 */
	async function pollOnce(): Promise<void> {
		if (!armed || !store || !record) return;
		const mail = await store.peek(record.id, MAX_LIMIT);
		const unread = new Set(mail.map((message) => message.id));
		reported = new Set([...reported].filter((id) => unread.has(id)));
		// A message that expired or was consumed leaves the queue with its file.
		pendingMail = pendingMail.filter((message) => unread.has(message.id));
		const queued = new Set(pendingMail.map((message) => message.id));
		const fresh = mail.filter((message) => !reported.has(message.id) && !queued.has(message.id));
		if (fresh.length === 0) return;
		pendingMail = [...pendingMail, ...fresh];
		if (wake) onWake?.();
	}

	function disarm(): void {
		stopTicker?.();
		stopTicker = undefined;
		armed = false;
		wake = false;
		pendingMail = [];
	}

	async function watch(input: { wake?: boolean; stop?: boolean }): Promise<{ armed: boolean; wake: boolean }> {
		await currentRecord();
		if (input.stop) {
			disarm();
			return { armed: false, wake: false };
		}
		if (!armed) {
			armed = true;
			wake = input.wake === true;
			await pollOnce();
			if (watchMs > 0) stopTicker = interval(watchMs, () => void pollOnce().catch(() => {}));
			return { armed, wake };
		}
		// The mode is a setting, not an arm-time flag: an explicit `wake` changes it
		// under a queued notice, and an omitted one keeps it, so bare `watch` never
		// demotes an armed session.
		if (input.wake !== undefined) wake = input.wake;
		// Asking for wake over mail already queued is a request for that burst too;
		// mid-turn it is suppressed here and retried once the run settles.
		if (wake && pendingMail.length > 0) onWake?.();
		return { armed, wake };
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
		return record.label;
	}

	return {
		async start(context) {
			await ensureStarted(context);
		},

		async stop() {
			stopHeartbeat?.();
			stopHeartbeat = undefined;
			disarm();
			reported = new Set();
			if (store && record && joined) {
				await store.releaseAll(record.id).catch(() => {});
				await store.removeSession(record.id).catch(() => {});
			}
			joined = false;
			starting = undefined;
			store = undefined;
			record = undefined;
		},

		watch,
		wantsWake: () => armed && wake,
		poll: pollOnce,
		pending: () => [...pendingMail],
		markReported,
		set onWake(callback: (() => void) | undefined) {
			onWake = callback;
		},

		async status() {
			const me = await currentRecord();
			return readStatus({ id: me.id, label: me.label }, false);
		},

		async snapshot() {
			if (!store || !record) throw new Error("session bus is not started.");
			return readStatus({ id: record.id, label: record.label }, true);
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
			markReported(messages.map((message) => message.id));
			return messages;
		},

		async claim(rawPaths) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			return store.claimAll(storedPaths(me, rawPaths), me.id, me.label, now());
		},

		async release(rawPaths) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const released: string[] = [];
			const notOwned: string[] = [];
			for (const path of storedPaths(me, rawPaths)) {
				if (await store.release(path, me.id)) released.push(path);
				else notOwned.push(path);
			}
			return { released, notOwned };
		},

		async join(input) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			if (!splitEnabled(me.cwd, me.repoRoot)) throw new Error(SPLIT_OFF_NOTE);
			const unit = resolveUnit(plansRoot ?? "", input, "join");
			const claimed = await store.claimAll(rootedPaths(me, unit.paths), me.id, me.label, now());
			return { team: unit.team, unit: unit.name, ...claimed };
		},

		async leave(input) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const paths =
				input.team === undefined && input.unit === undefined
					? (await store.claims()).filter((claim) => claim.owner === me.id).map((claim) => claim.path)
					: rootedPaths(me, resolveUnit(plansRoot ?? "", input, "leave").paths);
			const released: string[] = [];
			const notOwned: string[] = [];
			for (const path of paths) {
				if (await store.release(path, me.id)) released.push(path);
				else notOwned.push(path);
			}
			return { released, notOwned };
		},

		rename,
	};
}
