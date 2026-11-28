/**
 * The file-backed store for one repository's session bus.
 *
 * Every session writes its own record, every message is its own file, and every
 * claim is an exclusive-create file. That keeps concurrent Pi processes off one
 * shared lock while still making the common operations atomic. The store knows
 * nothing about models or UI; it only reads and writes validated JSON.
 */

import { rm, stat } from "node:fs/promises";
import {
	busPaths,
	claimsWithLiveLabels,
	dropIfEmpty,
	dropStaleTemps,
	ensureDir,
	type HostIdentity,
	type HostRecord,
	parseClaimRecord,
	parseSessionRecord,
	publishNew,
	type ReadDocuments,
	readDocuments,
	readDocument,
	readHosts,
	replaceJson,
	storedName,
	writeJsonAtomic,
} from "../../lib/session-files.ts";
import { type BusMessage, holdsMessage } from "../../lib/session-mail.ts";
import type { MailStore } from "./mail-store.ts";
import { claimsConflict, keepsOverlap } from "./overlap.ts";
import type {
	ClaimConflict,
	ClaimRecord,
	DeliveryFailure,
	DropResult,
	InboxPeek,
	InboxRead,
	LapsedClaims,
	SessionRecord,
} from "./types.ts";

export interface BusStoreOptions {
	/** The repository bus directory, e.g. `<agent-dir>/repos/<id>/session-bus`. */
	dir: string;
	/**
	 * This machine's host id, stamped on every claim the store publishes.
	 *
	 * It is also what tells a claim of this machine's from one that arrived from the other machine
	 * through a sync client: the first lapses on its owner's record here, the second only when that
	 * machine's heartbeat ages out. Absent is a store built without an identity (a suite's), which
	 * writes claims an older build would have written.
	 */
	host?: string;
}

export interface BusStore {
	readonly dir: string;
	ensure(): Promise<void>;
	writeSession(record: SessionRecord): Promise<void>;
	sessions(): Promise<SessionRecord[]>;
	/** One session's record, or undefined when it is not on disk. */
	session(id: string): Promise<SessionRecord | undefined>;
	removeSession(id: string): Promise<void>;
	writeMessage(target: string, message: BusMessage): Promise<void>;
	/**
	 * Write one message for each recipient, and answer with those written and those a
	 * file could not be made for.
	 *
	 * A send is one file per inbox, not one transaction over several, so a failure part-way
	 * through leaves the recipients before it holding the message. Nothing here can make the
	 * set atomic — splitting the report from the write is the point — so the caller decides
	 * what a partial delivery means.
	 */
	writeTo(
		recipients: readonly { id: string; label: string }[],
		fields: Omit<BusMessage, "to" | "toLabel">,
	): Promise<{ delivered: string[]; failed: DeliveryFailure[] }>;
	/**
	 * Read up to `limit` messages from the front of a recipient's inbox without consuming
	 * them, skipping the ids the caller already has, with every id still unread.
	 */
	peek(id: string, options: { limit: number; known?: ReadonlySet<string> }): Promise<InboxPeek>;
	/**
	 * Read and consume up to `limit` messages from the front of a recipient's inbox, naming the
	 * files it could not validate instead of deleting them. A limit of zero consumes nothing.
	 */
	inbox(id: string, limit: number): Promise<InboxRead>;
	/**
	 * Remove the mail `ids` name, from the inboxes no record holds, and name what stayed.
	 *
	 * Only the unaccounted copies go: an id a live record's inbox also carries stays there, which
	 * is why one id can be both dropped and kept.
	 */
	dropUnaccounted(ids: readonly string[]): Promise<DropResult>;
	claims(): Promise<ClaimRecord[]>;
	/** Every machine that has written here, this one included. */
	hosts(): Promise<HostRecord[]>;
	/**
	 * Refresh this machine's own entry, creating it once.
	 *
	 * `publishNew` is the create, so two sessions starting at once agree on one file; after that the
	 * write is an ordinary atomic replacement of a file only this machine writes.
	 */
	writeHost(identity: HostIdentity, at: number): Promise<void>;
	claimAll(
		paths: readonly string[],
		owner: string,
		ownerLabel: string,
		at: number,
		/** Test seams: see {@link ClaimSeams}. */
		seams?: ClaimSeams,
	): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }>;
	release(path: string, owner: string): Promise<boolean>;
	releaseAll(owner: string): Promise<string[]>;
	/**
	 * Move one owner's claims to another, without a moment when a path is unowned (#835).
	 *
	 * `release` then `claim` is two passes with a gap, and a third claimer wins it. Each path is
	 * replaced in one step ({@link replaceJson}), and a path this owner does not hold comes back in
	 * `notHeld` — a transfer moves claims that exist, never one nobody made.
	 */
	transfer(
		paths: readonly string[],
		from: string,
		to: string,
		toLabel: string,
		at: number,
		/** Test seams: see {@link ClaimSeams}. */
		seams?: ClaimSeams,
	): Promise<{ moved: string[]; notHeld: string[] }>;
	/**
	 * Remove the records the TTL has taken and the temp files a crashed writer left, and answer
	 * the claims it took so a caller can say so. Cheap by design — two small directory reads —
	 * because an action runs it: a peer that died must lose the paths it held at the moment a
	 * claimant looks, without the claimant paying for every message on the bus first.
	 */
	pruneRecords(input: {
		now: number;
		/** The sessions known to be live when the caller read the bus. */
		activeIds: ReadonlySet<string>;
		/**
		 * Records whose process the caller found gone: they keep their row until their
		 * heartbeat ages out, and own no path and no mail in the meantime.
		 */
		goneIds?: ReadonlySet<string>;
		sessionTtlMs: number;
	}): Promise<LapsedClaims>;
	/**
	 * Remove the mail past its TTL from this session's inbox and from every inbox no record holds.
	 *
	 * The one call here whose cost grows with the mail on the bus, so it belongs to the clock the
	 * TTL is measured in — the heartbeat — rather than to every action. A day-old message reading
	 * as one for another ten seconds costs nobody. An inbox a live record holds is that session's
	 * to sweep, which is the rule the ledger states as "unheld": one session no longer walks a
	 * peer's mail on every tick, and mail nobody owns still finds its way out.
	 */
	pruneMail(input: { now: number; messageTtlMs: number; own: string }): Promise<void>;
}

/** The seam a claim batch offers a suite: where inside the batch a rival can be put. */
export interface ClaimSeams {
	/**
	 * Runs once, after the pre-check and before the first publish.
	 *
	 * The one place a suite can put a rival batch in the window the pre-check cannot see: a batch
	 * that is still checking has published nothing, so nothing tells the rival to stop.
	 */
	afterCheck?: () => Promise<void>;
	/** Runs after each path is published: the window between two creates of one batch. */
	afterClaim?: (path: string) => Promise<void>;
	/** Runs after each path a {@link BusStore.transfer} moved: the window between two moves. */
	afterMove?: (path: string) => Promise<void>;
}

/**
 * Release each path through `release`, reporting the ones this session did not
 * hold. One copy, because `release` and `leave` answer the same two lists, and a
 * second loop is how the two answers drift.
 */
export async function releaseClaimed(
	paths: readonly string[],
	release: (path: string) => Promise<boolean>,
): Promise<{ released: string[]; notOwned: string[] }> {
	const released: string[] = [];
	const notOwned: string[] = [];
	for (const path of paths) {
		if (await release(path)) released.push(path);
		else notOwned.push(path);
	}
	return { released, notOwned };
}

/** Create a store rooted at one repository's bus directory. */
export function createBusStore(options: BusStoreOptions): BusStore {
	const paths = busPaths(options.dir);
	const { dir, sessions: sessionsDir, claims: claimsDir, hosts: hostsDir } = paths;
	const host = options.host;
	const sessionFile = paths.recordOf;
	const inboxDir = paths.inboxOf;
	const claimFile = paths.claimOf;

	/**
	 * One message file in one inbox, created where it is not there yet.
	 *
	 * A local function rather than a method, because two entries of the store write through
	 * it and `this` is not a receiver a destructured caller keeps.
	 */
	async function writeMessageFile(target: string, message: BusMessage): Promise<void> {
		const directory = inboxDir(target);
		if (await holdsMessage(directory, message)) return;
		await writeJsonAtomic(paths.messageOf(target, message.id), message);
	}

	/**
	 * Every record this build can read, newest heartbeat first.
	 *
	 * The refused names are kept by {@link readSessionFiles} for `pruneRecords`, which is the one
	 * caller with somewhere to say them: a `sessions()` row has no room for "and one file I could
	 * not parse", and a bus that cannot read a record must not pass it off as absent.
	 */
	async function readSessions(): Promise<SessionRecord[]> {
		const { records } = await readSessionFiles();
		return records.sort((a, b) => b.lastSeen - a.lastSeen || a.label.localeCompare(b.label));
	}

	/** The same walk, kept whole: the records and the names the guard refused. */
	async function readSessionFiles(): Promise<ReadDocuments<SessionRecord>> {
		return readDocuments(sessionsDir, parseSessionRecord);
	}

	async function readClaims(): Promise<ClaimRecord[]> {
		return (await readDocuments(claimsDir, parseClaimRecord)).records.sort((a, b) => a.path.localeCompare(b.path));
	}

	/**
	 * Conflicts as a caller prints them: each owner is named by the label its record holds now, and the
	 * one captured at claim time is the fallback for an owner no record names.
	 */
	async function liveConflicts(conflicts: readonly ClaimConflict[]): Promise<ClaimConflict[]> {
		return conflicts.length === 0 ? [] : claimsWithLiveLabels(conflicts, await readSessions());
	}

	async function claimOne(
		path: string,
		owner: string,
		ownerLabel: string,
		at: number,
	): Promise<{ claim: ClaimRecord; conflict?: ClaimRecord; created: boolean }> {
		const file = claimFile(path);
		const claim: ClaimRecord = { path, owner, ownerLabel, at, ...(host === undefined ? {} : { host }) };
		// Publish a written temp file instead of creating the claim and filling it
		// afterwards: the link is the exclusive create, so no reader can observe a
		// half-written claim and mistake it for a crashed owner's.
		if (await publishNew(file, claim)) return { claim, created: true };
		const existing = readDocument(file, parseClaimRecord);
		if (existing) {
			return existing.owner === owner
				? { claim: existing, created: false }
				: { claim, conflict: existing, created: false };
		}
		// A claim file that does not parse is debris from before claims were
		// published whole; clear it once so a stale path cannot block forever.
		await rm(file, { force: true });
		if (!(await publishNew(file, claim))) throw new Error(`the claim on ${path} kept being recreated under it`);
		return { claim, created: true };
	}

	async function releaseOne(path: string, owner: string): Promise<boolean> {
		const file = claimFile(path);
		const existing = readDocument(file, parseClaimRecord);
		if (!existing || existing.owner !== owner) return false;
		await rm(file, { force: true });
		return true;
	}

	/**
	 * Claim every path for one owner, or nothing.
	 *
	 * The pre-check reads the claims once and reports every blocking owner, so a
	 * batch that cannot be satisfied touches no file. One owner blocking one
	 * requested path is one conflict, however many of its claims reach under that
	 * path: the sentence a caller prints is per conflict, and a second copy of it is
	 * not a second blocker. A create that loses a race after the pre-check gives back
	 * only what this batch published: a path the owner already held carries an older
	 * `at` and is not this batch's to release.
	 *
	 * The pre-check cannot decide *overlapping* paths, because those are two different files: `link`
	 * is exclusive per name, so `src` and `src/api` claimed at once both publish. So a batch that
	 * published re-reads once and settles — {@link keepsOverlap} picks the keeper, and the loser gives
	 * back the whole batch and names the winner. A pair may hold overlapping paths for the length of
	 * one batch, and never keep them.
	 */
	async function transfer(
		paths: readonly string[],
		from: string,
		to: string,
		toLabel: string,
		at: number,
		seams: ClaimSeams = {},
	): Promise<{ moved: string[]; notHeld: string[] }> {
		const moved: string[] = [];
		const notHeld: string[] = [];
		for (const path of paths) {
			const file = claimFile(path);
			const existing = readDocument(file, parseClaimRecord);
			if (!existing || existing.owner !== from) {
				notHeld.push(path);
				continue;
			}
			const next: ClaimRecord = { ...existing, owner: to, ownerLabel: toLabel, at };
			await replaceJson(file, host === undefined ? next : { ...next, host });
			moved.push(path);
			if (seams.afterMove) await seams.afterMove(path);
		}
		return { moved, notHeld };
	}

	async function claimAll(
		paths: readonly string[],
		owner: string,
		ownerLabel: string,
		at: number,
		seams: ClaimSeams = {},
	): Promise<{ claimed: string[]; conflicts: ClaimConflict[] }> {
		const existing = await readClaims();
		const conflicts: ClaimConflict[] = [];
		for (const path of paths) {
			for (const held of existing) {
				if (held.owner === owner || !claimsConflict(path, held.path)) continue;
				if (conflicts.some((entry) => entry.path === path && entry.owner === held.owner)) continue;
				conflicts.push({ path, owner: held.owner, ownerLabel: held.ownerLabel });
			}
		}
		if (conflicts.length > 0) return { claimed: [], conflicts: await liveConflicts(conflicts) };
		if (seams.afterCheck) await seams.afterCheck();
		const claimed: string[] = [];
		const created: string[] = [];
		for (const path of paths) {
			const result = await claimOne(path, owner, ownerLabel, at);
			if (result.conflict) {
				for (const done of created) await releaseOne(done, owner);
				const { owner: holder, ownerLabel: holderLabel } = result.conflict;
				return { claimed: [], conflicts: await liveConflicts([{ path, owner: holder, ownerLabel: holderLabel }]) };
			}
			claimed.push(path);
			if (result.created) created.push(path);
			if (seams.afterClaim) await seams.afterClaim(path);
		}
		const settled = await settleOverlaps(claimed, owner);
		if (settled.length > 0) {
			// What this batch published goes, and nothing else: a claim is all-or-nothing, so half a
			// batch would report a success nobody asked for — but a path the owner already held is not
			// this batch's to give back, which is the rule the create-race rollback above keeps too.
			for (const path of created) await releaseOne(path, owner);
			return { claimed: [], conflicts: settled };
		}
		return { claimed, conflicts: [] };
	}

	/**
	 * Whether a claim still holds, which is a question about a machine before it is about an owner.
	 *
	 * This machine's claim (or one an older build wrote, which could only have been made here) is the
	 * owner's record: a session whose heartbeat aged out owns nothing, and one whose process is gone
	 * owns nothing sooner than that. Another machine's claim is that machine's heartbeat — the one
	 * clock a peer cannot read for itself, measured by the same `SESSION_TTL_MS` the roster applies —
	 * falling back to the claim's own `at` when no row for that machine is here at all, because a claim
	 * with no evidence behind it is the debris that window is for.
	 */
	function claimHolds(
		claim: ClaimRecord,
		live: ReadonlySet<string>,
		beats: ReadonlyMap<string, number>,
		at: number,
		ttlMs: number,
	): boolean {
		if (claim.host === undefined || claim.host === host) return live.has(claim.owner);
		return at - (beats.get(claim.host) ?? claim.at) <= ttlMs;
	}

	/**
	 * Which of this batch's paths a rival published first — the settle step's one question.
	 *
	 * Bounded by the batch: it stats the claim this batch published and each rival claim that
	 * overlaps one of its paths, and nothing else. `readClaims` parses every claim file and is what
	 * the board performs once a second, so it must not start paying a stat per claim in the
	 * repository; that is also why `ClaimRecord` does not grow an mtime field.
	 */
	async function settleOverlaps(mine: readonly string[], owner: string): Promise<ClaimConflict[]> {
		const conflicts: ClaimConflict[] = [];
		if (mine.length === 0) return conflicts;
		const held = await readClaims();
		const times = new Map<string, number | undefined>();
		const timeOf = async (path: string): Promise<number | undefined> => {
			if (times.has(path)) return times.get(path);
			const info = await stat(claimFile(path)).catch(() => undefined);
			times.set(path, info?.mtimeMs);
			return info?.mtimeMs;
		};
		for (const path of mine) {
			const mineAt = await timeOf(path);
			// The file is gone: something else settled this batch already, and there is nothing to defend.
			if (mineAt === undefined) continue;
			for (const rival of held) {
				if (rival.owner === owner || !claimsConflict(path, rival.path)) continue;
				const rivalAt = await timeOf(rival.path);
				// A rival that is gone released it — it lost to somebody in the same window.
				if (rivalAt === undefined) continue;
				if (keepsOverlap({ mtimeMs: mineAt, owner }, { mtimeMs: rivalAt, owner: rival.owner })) continue;
				if (conflicts.some((entry) => entry.path === path && entry.owner === rival.owner)) continue;
				conflicts.push({ path, owner: rival.owner, ownerLabel: rival.ownerLabel });
			}
		}
		return conflicts;
	}

	/**
	 * The mail family, loaded on the first call that needs it.
	 *
	 * A deferral rather than a preference: this entry's static module budget is exactly full, and one
	 * more evaluation fails `test/dependencies.test.ts`. `lib/lazy.ts` is the house idiom and is itself
	 * a module this entry does not otherwise load, so the one-load promise is kept here instead.
	 */
	let mail: Promise<MailStore> | undefined;
	const mailStore = (): Promise<MailStore> =>
		(mail ??= import("./mail-store.ts").then((module) => module.createMailStore(dir)));

	return {
		dir,
		async ensure() {
			await Promise.all([ensureDir(sessionsDir), ensureDir(paths.inbox), ensureDir(claimsDir)]);
		},

		async writeSession(record) {
			await writeJsonAtomic(sessionFile(record.id), record);
		},

		sessions: readSessions,

		session: async (id) => readDocument(sessionFile(id), parseSessionRecord),

		async removeSession(id) {
			await rm(sessionFile(id), { force: true });
			await dropIfEmpty(inboxDir(id));
		},

		writeMessage: writeMessageFile,

		async writeTo(recipients, fields) {
			const delivered: string[] = [];
			const failed: DeliveryFailure[] = [];
			for (const recipient of recipients) {
				try {
					await writeMessageFile(recipient.id, { ...fields, to: recipient.id, toLabel: recipient.label });
					delivered.push(recipient.label);
				} catch (error) {
					// The recipient's own sentence, kept as it came: it is the reason a caller
					// prints, and a filesystem refusal means nothing once it is rewritten.
					failed.push({ label: recipient.label, error: error instanceof Error ? error.message : String(error) });
				}
			}
			return { delivered, failed };
		},

		/**
		 * Remove the mail `ids` name from the inboxes no record holds.
		 *
		 * Attribution is the store's own: an inbox is filed under the hash of its recipient's id, so
		 * hashing each record's id is the whole answer to "does anybody hold this mail" — no field a
		 * message could lie about, and no need to invert the hash of a directory's name. It is read
		 * here, at the delete, rather than by the caller that listed the mail: a session that resumed
		 * in between holds its mail again, and a listing is stale the moment its person reads it.
		 *
		 * An id a held inbox carries is refused and handed back with its holder's label. That is the
		 * one guard this door needs, because a mistaken id would otherwise destroy mail its session
		 * can still read; nothing else on the bus is this destructive and irreversible.
		 */
		// The mail family, delegated to the module that owns it: loaded on the first call that needs
		// it, because this entry's static module budget is exactly full (see `mailStore`).
		async peek(id, options) {
			return (await mailStore()).peek(id, options);
		},

		async inbox(id, limit) {
			return (await mailStore()).inbox(id, limit);
		},

		async dropUnaccounted(ids) {
			// The holder of every inbox, read now rather than when the caller listed the mail: a
			// session that resumed in between holds its inbox again.
			const held = new Map((await readSessions()).map((session) => [session.id, session.label]));
			return (await mailStore()).dropUnaccounted(ids, held);
		},

		claims: readClaims,

		hosts: () => readHosts(dir),

		async writeHost(identity, at) {
			const record: HostRecord = { host: identity.id, name: identity.name, lastSeen: at };
			await ensureDir(hostsDir);
			// The create is exclusive so two sessions of one machine cannot each make its row; after
			// that every write is this machine's own, which is what keeps the file one file.
			if (await publishNew(paths.hostOf(identity.id), record)) return;
			await writeJsonAtomic(paths.hostOf(identity.id), record);
		},

		claimAll,

		release: releaseOne,

		transfer,

		async releaseAll(owner) {
			const released: string[] = [];
			for (const claim of await readClaims()) {
				if (claim.owner !== owner) continue;
				await rm(claimFile(claim.path), { force: true });
				released.push(claim.path);
			}
			return released;
		},

		async pruneRecords({ now: at, activeIds, goneIds, sessionTtlMs }) {
			// The caller's set can lag, so this read only adds to it rather than deciding who
			// survives — except for a record whose process is gone, which the caller knows and the
			// file cannot: it keeps its row until the heartbeat ages out, and owns nothing.
			const live = new Set(activeIds);
			const gone = new Set(goneIds ?? []);
			const lapsed: ClaimRecord[] = [];
			// The names the guard refused, reported rather than discarded — and never deleted: an older
			// build must not destroy a newer build's record, so a file this build cannot read is left
			// where it is and said out loud, which is the rule `session-mail.ts` keeps for a message.
			const { records, refused } = await readSessionFiles();
			for (const session of records) {
				if (at - session.lastSeen > sessionTtlMs) {
					await rm(sessionFile(session.id), { force: true });
					await dropIfEmpty(inboxDir(session.id));
					live.delete(session.id);
				} else if (gone.has(session.id)) {
					live.delete(session.id);
				} else {
					live.add(session.id);
				}
			}
			// A claim lapses on the owner's record only where that record is *here*; another machine's
			// is judged by that machine's heartbeat, because a local pid says nothing about it.
			const beats = new Map((await readHosts(dir)).map((entry) => [entry.host, entry.lastSeen]));
			for (const claim of await readClaims()) {
				if (claimHolds(claim, live, beats, at, sessionTtlMs)) continue;
				await rm(claimFile(claim.path), { force: true });
				lapsed.push(claim);
			}
			await dropStaleTemps(sessionsDir);
			await dropStaleTemps(claimsDir);
			return { claims: lapsed, refused };
		},

		async pruneMail(input) {
			// Who holds an inbox, read at the sweep: a record pruned a moment ago leaves its mail
			// unheld, and an inbox nobody holds is what this session may end.
			const held = new Set((await readSessions()).map((session) => storedName(session.id)));
			return (await mailStore()).pruneMail(input, held);
		},
	};
}
