/**
 * The session label: the one name another session addresses this one by.
 *
 * Two vocabularies share this module, and neither copies the other. `session-bus`
 * settles its own label for a session that did not ask for one — the Pi session name,
 * else the working directory's basename, else the id. The board names a session for
 * the team instead: the page's seat, or a preset teammate name drawn from the id, or
 * `team-agent-` and the id's tail when every preset one is taken — one name on every
 * surface, and one that cannot drift on a rename. The rules are here rather than in
 * either extension because a label is a shared vocabulary: it is displayed, it is a
 * send target, and it is stored in a card file that outlives one session.
 *
 * Value-only: no state, no I/O.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sanitizeLine } from "./format.ts";

/** Longest label, in characters, that a session may be addressed by. */
export const MAX_LABEL = 40;

/**
 * A safe label, used both for display and as a target.
 *
 * Flattened to one line and capped, so a name can never wrap a row or open a
 * second line in a page; an empty one falls back rather than leaving a blank chip.
 */
export function normalizeLabel(raw: string | undefined, fallback: string): string {
	const text = sanitizeLine(raw ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return (text || fallback).slice(0, MAX_LABEL);
}

/** A short, display-only suffix for a session id. */
export function shortId(id: string): string {
	const clean = id.replace(/[^a-zA-Z0-9]/g, "");
	return (clean || id).slice(-6);
}

/**
 * The automatic label, before uniqueness is applied.
 *
 * The bus appends a suffix when two live sessions share one; that decision belongs
 * to the registry, so this is only the name a session would pick for itself.
 */
export function defaultLabel(sessionName: string | undefined, cwd: string, id = "session"): string {
	const directory = cwd.split(/[\\/]/).filter(Boolean).at(-1);
	const base = normalizeLabel(sessionName, normalizeLabel(directory, "session"));
	return normalizeLabel(base, `session-${shortId(id)}`);
}

/** The prefix of the team's name for a session that is not the page's seat. */
export const TEAM_AGENT_PREFIX = "team-agent-";

/**
 * The team's name for a session: the prefix and the id's tail.
 *
 * A team is addressed by id, not by a name a user chose: an id is unique, so two
 * sessions cannot settle on one name, and a rename cannot strand the card that
 * recorded it. The seat is the one name that is a role instead.
 */
export function agentLabel(id: string): string {
	return normalizeLabel(`${TEAM_AGENT_PREFIX}${shortId(id)}`, "team-agent");
}

/**
 * The preset teammate names a session with no name of its own draws from.
 *
 * Familiar English names, one or two syllables each, short enough to type as a `to`
 * target: a teammate should read as a person, and `lily` says more than
 * `team-agent-9f21ac` to the lead who hands it a card.
 */
export const TEAMMATE_NAMES = [
	"tom",
	"amy",
	"lily",
	"jack",
	"lucy",
	"mike",
	"kate",
	"sam",
	"bob",
	"anna",
	"helen",
	"peter",
	"alice",
	"emma",
	"jenny",
	"mary",
	"linda",
	"susan",
	"tina",
	"ben",
	"may",
	"rose",
	"david",
	"leo",
] as const;

/** A 32-bit FNV-1a hash, so one id always starts the draw at the same name. */
function hashOf(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * The preset name a session with none of its own joins under.
 *
 * Its id hashes to a starting point in the list, and a name in `taken` walks on to the
 * next free one; every name taken is `undefined`, so the caller keeps a fallback that
 * cannot collide. Drawn from the id rather than at random, because the board writes a
 * card before it joins: one session has to draw one name on every call and after a
 * restart, so the card, the join, and the roster say the same word. `taken` is
 * compared case-insensitively, the way a label is addressed.
 */
export function presetNameFor(id: string, taken: Iterable<string> = []): string | undefined {
	const held = new Set([...taken].map((label) => label.toLowerCase()));
	const start = hashOf(id) % TEAMMATE_NAMES.length;
	for (let step = 0; step < TEAMMATE_NAMES.length; step += 1) {
		const name = TEAMMATE_NAMES[(start + step) % TEAMMATE_NAMES.length];
		if (!held.has(name)) return name;
	}
	return undefined;
}

/**
 * Pi's session name, which is the first choice for a label.
 *
 * A host that has no session name, or refuses the call, yields `undefined` rather
 * than an error: a label is a convenience, and a session that cannot name itself
 * still works under the fallback chain above.
 */
export function sessionNameOf(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
	try {
		return ctx.sessionManager.getSessionName();
	} catch {
		return undefined;
	}
}

/**
 * The session's id, or undefined when the host does not report one.
 *
 * Read beside the name because they are the same fact from two sides: a name is how a
 * person reads a session, an id is how one is filed — a bus record, a card's owner, a
 * resume. A host that refuses the call is a session with no id, not an error.
 */
export function sessionIdOf(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
	try {
		const id = ctx.sessionManager.getSessionId();
		return typeof id === "string" && id !== "" ? id : undefined;
	} catch {
		return undefined;
	}
}

/**
 * `pi.events` channel: a session settled the label its peers address it by.
 *
 * Here rather than in `lib/events.ts`, the way `lib/plan-entry.ts` and `lib/http/mount.ts`
 * keep their own: a label is this module's vocabulary, and both sides of the channel — the
 * bus that settles one and the footer that draws it — already load this module, so the
 * literal costs a registration graph nothing and cannot be re-typed on one side.
 */
export const SESSION_LABEL_CHANNEL = "my-pi-agent/session-label";

/**
 * Payload on {@link SESSION_LABEL_CHANNEL}: one session's name on the bus.
 *
 * Emitted by `session-bus` whenever it settles or yields a label, and read by bytefly's
 * footer, which draws it instead of Pi's own session name: the two part company the moment
 * the board seats a session under a preset teammate name, or a collision appends an id. The
 * id rides along because the channel reaches every session in the process, and only the one
 * named here is the reader's own.
 */
export interface SessionLabelEvent {
	/** Pi session id the label belongs to. */
	id: string;
	/** The name another session addresses this one by. */
	label: string;
}
