/**
 * The session label: the one name another session addresses this one by.
 *
 * Two vocabularies share this module, and neither copies the other. `session-bus`
 * settles its own label for a session that did not ask for one — the Pi session name,
 * else the repository's own name (the main checkout's directory, never the worktree
 * the session sits in), else the id. The board names a session for the team instead:
 * the page's seat, or the id-derived `team-agent-` name when the session has none of its
 * own — one name on every surface, and one that cannot drift on a rename. The rules are here rather than in
 * either extension because a label is a shared vocabulary: it is displayed, it is a
 * send target, and it is stored in a card file that outlives one session.
 *
 * Value-only: no state, no I/O.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { pageSource, sanitizeLine } from "./format.ts";

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
 * The key two labels meet under in a Map or a Set: a label is addressed without case.
 *
 * The round's owner groups, the bus's held names and a page's label maps all key by label, and
 * each was its own `toLowerCase()`. A key is the comparison's other half — a map keyed one way
 * and looked up another is the same drift as two comparisons — so it is here, beside the compare.
 */
export function labelKey(label: string): string {
	return label.toLowerCase();
}

/**
 * Whether `a` and `b` are one name: a label is a send target without case, wherever it is compared.
 *
 * Written out rather than through {@link labelKey} because a comparison and a map key are
 * different questions: this one is a line, and it reads as itself wherever it is called.
 */
export function sameLabel(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/** The same body, as the browser receives it: one comparison for the page and the terminal. */
export const SAME_LABEL_JS = pageSource(sameLabel);

/**
 * The same body, as the browser receives it: the key a page's label map is written under.
 *
 * A fragment keys its maps by label — the owners a round groups, the sessions whose process is
 * gone — so it needs the key half too. Splice both and the page cannot spell a label map one way
 * and look it up another.
 */
export const LABEL_KEY_JS = pageSource(labelKey);

/** The prefix of the team's name for a session that is not the page's seat. */
export const TEAM_AGENT_PREFIX = "team-agent-";

/**
 * The team's name for a session: the prefix and the id's tail.
 *
 * A team is addressed by id, not by a name a user chose: an id is unique, so two
 * sessions cannot settle on one name, and a rename cannot strand the card that
 * recorded it. The seat is the one name that is a role instead, and the board draws a free
 * `team.teammates` name first, so this is the name a team that gives nobody leaves.
 */
export function agentLabel(id: string): string {
	// The prefix alone is already a name, so the fallback `normalizeLabel` wants is that prefix
	// rather than a second spelling of it: the label can never be empty.
	return normalizeLabel(`${TEAM_AGENT_PREFIX}${shortId(id)}`, TEAM_AGENT_PREFIX);
}

/** The most names a team may hold: the bar compares a session's name against each one. */
export const MAX_TEAMMATES = 20;

/**
 * The names a file states as a team: the labels it wrote, in the order it says them.
 *
 * The project's list is the whole vocabulary — there is no built-in set to match — so a name is
 * kept as one line, the way every label is, and a name stated twice is dropped because a team is
 * a set. An empty list is an answer and stays empty: it is a project saying nobody is on its
 * team, which is not the same as a file that said nothing. Past {@link MAX_TEAMMATES} the rest is
 * not a team a bar can keep.
 */
export function normalizeTeammates(raw: unknown, base: readonly string[] = []): readonly string[] {
	if (!Array.isArray(raw)) return base;
	const kept: string[] = [];
	for (const value of raw) {
		if (typeof value !== "string") continue;
		const name = labelKey(normalizeLabel(value, ""));
		if (name === "" || kept.includes(name)) continue;
		kept.push(name);
		if (kept.length === MAX_TEAMMATES) break;
	}
	return kept;
}

/** Whether `name` is one of the team's, compared without case the way a label is addressed. */
export function isTeammate(name: string | null | undefined, team: readonly string[]): boolean {
	if (name === null || name === undefined) return false;
	return team.some((member) => sameLabel(member, name));
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
 * the board seats a session under the page's role, or a collision appends an id. The
 * id rides along because the channel reaches every session in the process, and only the one
 * named here is the reader's own.
 */
export interface SessionLabelEvent {
	/** Pi session id the label belongs to. */
	id: string;
	/** The name another session addresses this one by. */
	label: string;
}

/**
 * The automatic label, before uniqueness is applied.
 *
 * The bus appends a suffix when two live sessions share one; that decision belongs
 * to the registry, so this is only the name a session would pick for itself.
 */
export function defaultLabel(facts: LabelFacts): string {
	const checkouts = [...(facts.checkouts ?? [])];
	const taken = checkoutNames(checkouts);
	// A name a worktree produced is no name: it leaves with the worktree, and the next
	// session named after one is a different session under the same word.
	const named = normalizeLabel(facts.sessionName, "");
	const own = named !== "" && !taken.has(labelKey(named)) ? named : "";
	// Read here rather than through `lib/path.ts`: this module is on every extension's import path, and
	// a start pays for what its entry pulls. The expression is `lastSegment`'s own, spelled out because
	// one call cannot justify a module on eight entries.
	const path = checkouts[0]?.path ?? facts.cwd;
	const repository = path.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
	const base = own || normalizeLabel(repository, "session");
	return normalizeLabel(base, `session-${shortId(facts.id ?? "session")}`);
}

/** What a session knows about itself when it picks a name. */
export interface LabelFacts {
	/** Pi's session name, when the session has one. */
	sessionName?: string;
	/** The session's working directory. */
	cwd: string;
	/** The session's id, for the last fallback. */
	id?: string;
	/** The repository's working trees, the main checkout first, when git resolved them. */
	checkouts?: Iterable<Checkout>;
}

/** A working tree, as the label rules read one. */
export interface Checkout {
	/** The worktree's directory. */
	path: string;
	/** The branch checked out there, without `refs/heads/`. */
	branch?: string;
}

/** The default branch prefix a worktree of this repository is cut on. */
const WORKTREE_BRANCH_PREFIX = "worktree-";

/**
 * The names that are a checkout's rather than a session's.
 *
 * A session is named for what it is doing; a worktree is named for the work it holds,
 * and its branch is `worktree-<x>` by the worktree extension's default. Neither is an
 * identity a peer can address twice: the directory goes when the work is landed, and
 * the branch is rebased or deleted after it. Lower-cased, because a label is addressed
 * without case; the exact branch is named too, so a prefix someone configured is still
 * caught by it as well as by the directory.
 */
export function checkoutNames(trees: Iterable<Checkout>): Set<string> {
	const names = new Set<string>();
	for (const tree of trees) {
		const directory = labelKey(tree.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "");
		if (directory !== "") names.add(directory);
		const branch = tree.branch === undefined ? undefined : labelKey(tree.branch);
		if (!branch) continue;
		names.add(branch);
		if (branch.startsWith(WORKTREE_BRANCH_PREFIX)) names.add(branch.slice(WORKTREE_BRANCH_PREFIX.length));
	}
	return names;
}
