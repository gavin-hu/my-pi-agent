/**
 * Session-bus lifecycle and operations.
 *
 * A terminal session registers on `session_start`. RPC, JSON, print, and WeChat
 * peer sessions stay invisible until they call the tool or `/sessions`, so a
 * subagent or phone peer does not join a team merely because the package loaded.
 * The runtime owns the heartbeat, keeps no module-level state, and uses the
 * common git directory so worktrees of one repository share one bus.
 */

import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createExecRunner, gitCommonDir, repoRoot } from "../../lib/git/index.ts";
import {
	claimsConflict,
	defaultLabel,
	isAutoJoinMode,
	normalizeKind,
	normalizeLabel,
	normalizeLimit,
	normalizePaths,
	normalizeText,
	resolveRecipients,
	sessionMode,
	shortId,
} from "./protocol.ts";
import { createBusStore, type BusStore } from "./store.ts";
import type { BusMessage, ClaimConflict, SessionRecord, SessionStatus } from "./types.ts";

export interface SessionBusOptions {
	now?: () => number;
	/** Test seam: use this bus directory instead of the agent-dir layout. */
	dir?: string;
	/** Test seam: skip git and use this repository identity. */
	repo?: { root: string; key: string };
	/** Heartbeat interval; 0 disables it (tests). */
	heartbeatMs?: number;
	sessionTtlMs?: number;
	messageTtlMs?: number;
}

export interface SessionBus {
	start(ctx: ExtensionContext): Promise<void>;
	stop(): Promise<void>;
	status(): Promise<SessionStatus>;
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
	current(): { id: string; label: string } | undefined;
}

const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60_000;
const DEFAULT_MESSAGE_TTL_MS = 24 * 60 * 60_000;
const MAX_KEY = 12;

function keyFor(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, MAX_KEY);
}

function messageId(now: number): string {
	return `${now}-${randomBytes(4).toString("hex")}`;
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
	const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
	const messageTtlMs = options.messageTtlMs ?? DEFAULT_MESSAGE_TTL_MS;

	let store: BusStore | undefined;
	let record: SessionRecord | undefined;
	let joined = false;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let starting: Promise<void> | undefined;

	const ensureStarted = async (context: ExtensionContext): Promise<void> => {
		if (starting) return starting;
		starting = (async () => {
			const cwd = context.cwd;
			const repo = options.repo ?? (await resolveRepo(context.cwd));
			const dir = options.dir ?? join(getAgentDir(), "session-bus", repo.key);
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

	async function resolveRepo(cwd: string): Promise<{ root: string; key: string }> {
		try {
			const run = createExecRunner(pi);
			const [common, root] = await Promise.all([gitCommonDir(run, cwd), repoRoot(run, cwd)]);
			if (root) return { root, key: keyFor(common ?? root) };
		} catch {
			// No git: fall back to the working directory below.
		}
		const root = cwd;
		return { root, key: keyFor(root) };
	}

	async function joinBus(): Promise<void> {
		if (!store || !record) throw new Error("session bus is not started.");
		if (joined) return;
		const sessions = await store.sessions();
		let candidate = record.label;
		const used = new Set(
			sessions.filter((session) => session.id !== record?.id).map((session) => session.label.toLowerCase()),
		);
		if (used.has(candidate.toLowerCase())) candidate = `${candidate}-${shortId(record.id)}`.slice(0, 40);
		record.label = candidate;
		record.lastSeen = now();
		await store.writeSession(record);
		joined = true;
		if (heartbeatMs > 0) {
			heartbeat = setInterval(() => {
				if (!record || !store) return;
				record.lastSeen = now();
				void store.writeSession(record).catch(() => {});
			}, heartbeatMs);
			(heartbeat as { unref?: () => void }).unref?.();
		}
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
			sessions.filter((session) => now() - session.lastSeen <= sessionTtlMs).map((session) => session.id),
		);
		if (record) active.add(record.id);
		await store.prune({ now: now(), activeIds: active, sessionTtlMs, messageTtlMs });
	}

	async function currentRecord(): Promise<SessionRecord> {
		await prepare();
		if (!record) throw new Error("session bus is not started.");
		return record;
	}

	async function rename(label: string): Promise<string> {
		if (!store || !record) throw new Error("session bus is not started.");
		const candidate = normalizeLabel(label, record.label);
		const sessions = await store.sessions();
		if (
			sessions.some((session) => session.id !== record?.id && session.label.toLowerCase() === candidate.toLowerCase())
		) {
			throw new Error(`the label "${candidate}" is already in use.`);
		}
		record.label = candidate;
		record.lastSeen = now();
		await store.writeSession(record);
		joined = true;
		return candidate;
	}

	return {
		async start(context) {
			await ensureStarted(context);
		},

		async stop() {
			if (heartbeat) clearInterval(heartbeat);
			heartbeat = undefined;
			if (store && record && joined) {
				await store.releaseAll(record.id).catch(() => {});
				await store.removeSession(record.id).catch(() => {});
			}
			joined = false;
			starting = undefined;
			store = undefined;
			record = undefined;
		},

		async status() {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const sessions = await store.sessions();
			const claims = await store.claims();
			const withUnread = await Promise.all(
				sessions.map(async (session) => ({ ...session, unread: (await store?.unread(session.id)) ?? 0 })),
			);
			return { me: { id: me.id, label: me.label }, sessions: withUnread, claims };
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
			if (input.paths !== undefined) {
				const normalized = normalizePaths(me.repoRoot, me.cwd, input.paths);
				if ("error" in normalized) throw new Error(normalized.error);
				paths = normalized.paths;
			}
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
			return store.inbox(me.id, normalizeLimit(limit));
		},

		async claim(rawPaths) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const normalized = normalizePaths(me.repoRoot, me.cwd, rawPaths);
			if ("error" in normalized) throw new Error(normalized.error);
			const existing = await store.claims();
			const conflicts: ClaimConflict[] = [];
			for (const path of normalized.paths) {
				for (const claim of existing) {
					if (claimsConflict(path, claim.path) && claim.owner !== me.id) {
						conflicts.push({ path, owner: claim.owner, ownerLabel: claim.ownerLabel });
					}
				}
			}
			if (conflicts.length > 0) return { claimed: [], conflicts };
			const claimed: string[] = [];
			for (const path of normalized.paths) {
				const result = await store.claim(path, me.id, me.label, now());
				if (result.conflict) {
					for (const done of claimed) await store.release(done, me.id);
					return {
						claimed: [],
						conflicts: [{ path, owner: result.conflict.owner, ownerLabel: result.conflict.ownerLabel }],
					};
				}
				claimed.push(path);
			}
			return { claimed, conflicts: [] };
		},

		async release(rawPaths) {
			const me = await currentRecord();
			if (!store) throw new Error("session bus is not started.");
			const normalized = normalizePaths(me.repoRoot, me.cwd, rawPaths);
			if ("error" in normalized) throw new Error(normalized.error);
			const released: string[] = [];
			const notOwned: string[] = [];
			for (const path of normalized.paths) {
				if (await store.release(path, me.id)) released.push(path);
				else notOwned.push(path);
			}
			return { released, notOwned };
		},

		rename,

		current() {
			return record ? { id: record.id, label: record.label } : undefined;
		},
	};
}
