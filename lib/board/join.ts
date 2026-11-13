/**
 * The one join the board's doors ask for: the ask-once rule, and what a failure means.
 *
 * `board` joins when the page opens and when a card is claimed; `team` joins when a card
 * is claimed through the round, and **before** the handoff and the question it sends — the
 * message names this session as the way back, so a lead the bus will not hold is a reply the
 * peer's `session send` refuses. `/team join` is the fifth door and asks the bus directly,
 * because a typed label is a rename: it lands on the label it was given even when the bus
 * already holds this session.
 *
 * A join that did not land is a `TeamState` carrying the reason and, when one is known, what a
 * reader can do about it — the bus's sentence says what happened and never what to do, and the
 * door every other sentence names is the wrong advice in two of the three cases.
 *
 * The asking is shared because the rule around it is easy to get different in two places:
 * ask only while this session is not on the team, so a card write costs one request per
 * session rather than one per card, and never let the join undo a card that was already
 * written — a bus that is not loaded is a sentence, not an exception.
 *
 * Being on the team is read from the bus's own record, not from the standing alone: a
 * standing says a join once answered `ok`, and stays true after the bus stops, after the
 * TTL prunes the record, and after a `/resume` takes the seat over — so a claim that
 * trusted it would write a card under a name no peer resolves. The roster is that same
 * question asked of the files, which is what the round already reads.
 *
 * The record is also the only word on *which* name the bus holds, and that is why a join
 * asks when the label differs: the page serves as the seat, so opening it renames a session
 * that held another name, while a session already seated asks nothing.
 *
 * `lib/` is value-only, so the session and the join arrive as parameters, exactly as the
 * store does for the tools.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../errors.ts";
import { sessionIdOf } from "../session-label.ts";
import { type RosterSession, type RosterState, rosterStateOf } from "../session-roster.ts";
import { type JoinResult, NO_BUS_ERROR, type TeamJoin, type TeamJoinInput, type Watching } from "../session-tool.ts";
import type { BoardSession } from "./session.ts";

/**
 * The part of the session a join reads: where it stands, the clock, and the bus's records.
 *
 * All three, because being on the team is one rule and neither caller may answer it with
 * a different roster: the standing is what the last ask did, the clock is what the roster's
 * liveness is judged by, and the records are the bus's word for this repository.
 */
export type JoinSession = Pick<BoardSession, "team" | "roster" | "now">;

/**
 * What a `/board` line says about the team: the name peers resolve, and whether mail will
 * reach this session.
 *
 * The listening fact is optional because two answers are honest without it: a record written
 * before the field existed, and a session a bus never recorded. A line that guessed would
 * accuse a peer of ignoring mail, so the word is left out instead.
 *
 * A refusal carries `fix` when the join could tell what the caller should do next: the bus's
 * reason is a fact about what happened, and the door a reader reaches for is `/team join` —
 * which cannot help with no bus at all, and costs a lead its signature when another record
 * holds the name.
 */
export type TeamState = { label: string; listening?: boolean } | { error: string; fix?: string };

/** A standing or a fresh answer, as the line reads it. */
export function standingOf(result: JoinResult): TeamState;
export function standingOf(result: undefined): undefined;
export function standingOf(result: JoinResult | undefined): TeamState | undefined;
export function standingOf(result: JoinResult | undefined): TeamState | undefined {
	if (result === undefined) return undefined;
	if (!result.ok) return { error: result.error };
	return { label: result.label, listening: result.watching.armed };
}

/** What one live record says: the name it holds, its watch, and the process that wrote it. */
interface Held {
	label: string;
	watching?: Watching;
	/** The process that owns the record; absent is a record older than the field, or one no process holds. */
	pid?: number;
}

/**
 * The roster's answer about this session: a live record, no record, or no word at all.
 *
 * `absent` and `unknown` are different facts — a bus that has not recorded this session is
 * a join to spend, while a roster that cannot be read is no evidence either way — and they
 * are kept apart for the same reason `lib/session-roster.ts` says a missing directory is not
 * an error: a guess either way would be a write under a name nothing backs.
 */
type RosterAnswer = { kind: "held"; held: Held } | { kind: "absent" } | { kind: "unknown" };

/**
 * Whether `a` and `b` are one name: a label is case-insensitive when it is a send target, so
 * it is here too, exactly as `holds` compares an owner.
 */
function sameLabel(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/** A state from a live record, with the standing filling in a listening fact it cannot say. */
function stateOfHeld(held: Held, known: TeamState | undefined): TeamState {
	const listening = held.watching?.armed ?? (known !== undefined && "label" in known ? known.listening : undefined);
	return listening === undefined ? { label: held.label } : { label: held.label, listening };
}

/**
 * Whether the record is this process's own, which is the half a label cannot tell.
 *
 * A second pane opened on the same session id writes its own record, so a peer is reachable
 * and the label is right, but the watch is the other pane's: asking here is what arms this
 * pane's mail, the way the page did before a join learned to ask once. A record that names no
 * process is judged by its name alone, since there is nothing else to compare.
 */
function heldHere(held: Held): boolean {
	return held.pid === undefined || held.pid === process.pid;
}

/**
 * Put this session on the team, unless the bus already holds it here, under the name asked for.
 *
 * The live record decides, and the standing only fills in when the record cannot be read:
 * a session the bus holds under this name is on the team whatever this process remembers,
 * and one it holds under another name is renamed — which is how opening the page takes the
 * seat. A record under the name asked for is also the only evidence of a watch the user
 * turned off, so a rename repeats *its* choice rather than arming mail afresh.
 *
 * A failure is recorded and asked again by the next door, and so is a success the roster
 * does not back any more; a join that threw is swallowed here for the same reason, because
 * the card it came after is already true. The ask is recorded rather than returned, so no
 * door has to remember to do it.
 *
 * What a refusal carries besides its reason is `fix`, read from the roster the refusal leaves
 * behind: the bus's sentence says what happened, and a door that printed `/team join` over
 * every one of them would send a reader at the wrong door half the time.
 */
export async function joinTeam(
	session: JoinSession,
	team: TeamJoin,
	ctx: ExtensionContext,
	label: string,
): Promise<TeamState> {
	const standing = session.team.last();
	const answer = await rosterAnswer(session, ctx);
	if (answer.kind === "held" && heldHere(answer.held) && sameLabel(answer.held.label, label)) {
		return stateOfHeld(answer.held, standingOf(standing));
	}
	// No word from the bus keeps a standing that landed: the record may be there and unreadable,
	// and a join spent on a guess would rename a session the bus still holds.
	if (answer.kind === "unknown" && standing?.ok === true) return standingOf(standing);
	const joined = await ask(
		team,
		ctx,
		askAgain(standing, label, answer.kind === "held" ? answer.held.watching : undefined),
	);
	session.team.record(joined);
	if (joined.ok) return standingOf(joined);
	return { error: joined.error, ...(await fixOf(session, ctx, joined.error, label)) };
}

/**
 * What a reader can do about a join that did not land, when the failure says.
 *
 * Two of the three shapes have an answer, and both are the opposite of the door a refusal
 * names by habit. With no bus loaded, `/team join` refuses in the very same words: the
 * extension is off. With the name held, this session takes another one — and a lead that does
 * so stops being the lead, because the gates compare the label rather than an identity.
 * Anything else the bus says is its own sentence, with no advice grafted onto it.
 */
async function fixOf(
	session: JoinSession,
	ctx: ExtensionContext,
	error: string,
	label: string,
): Promise<{ fix?: string }> {
	if (error === NO_BUS_ERROR) return { fix: "Turn the `session-bus` extension on in `/bytefly`." };
	const held = await heldLabel(session, ctx, label);
	return held === undefined ? {} : { fix: heldFix(held) };
}

/**
 * A name another record holds, in the two shapes the bus leaves it in.
 *
 * `takenLabels` reserves a record for the heartbeat's TTL, so the holder is either a running
 * session — which nothing but its own stop frees — or a dead one the bus still remembers,
 * whose name comes back on its own. Both end in the same warning, because the other way past
 * a held name is the one door that renames, and renaming is what costs a lead its signature.
 */
function heldFix(state: RosterState): string {
	const rename = "a lead that renames loses its signature, because the gates compare `team.lead` by label";
	return state === "gone"
		? `The bus forgets that record when its heartbeat ages out; joining under another name works now, though ${rename}.`
		: `Only that session stopping frees the name, or join under another name now, though ${rename}.`;
}

/**
 * What the bus still holds under `label`, when it is not this session's own record.
 *
 * Asked after a refusal and answered from the files, because the bus's error names the holder
 * and this needs the one fact it leaves out: whether that holder is still running. A roster
 * that cannot be read is no evidence either way, so the failure keeps its reason and no advice.
 */
async function heldLabel(session: JoinSession, ctx: ExtensionContext, label: string): Promise<RosterState | undefined> {
	const id = sessionIdOf(ctx);
	let roster: RosterSession[] | undefined;
	try {
		roster = await session.roster(ctx.cwd);
	} catch {
		return undefined;
	}
	const record = roster?.find((entry) => entry.id !== id && sameLabel(entry.label, label));
	return record === undefined ? undefined : rosterStateOf(record, session.now());
}

/**
 * What this session's team is now, for `/board status`.
 *
 * The live record first: its label is what a peer resolves, and its `watching` is the fact a
 * disarm through `/session join` changes without telling this session. A record the bus no
 * longer holds is the bus saying this session is not on the team, so an old success is not
 * repeated; only a refusal stays, because it is the reason there is no team. A roster that
 * cannot be read is no answer at all, so there the standing is the best word there is.
 */
export async function teamStatus(session: JoinSession, ctx: ExtensionContext): Promise<TeamState | undefined> {
	const standing = session.team.last();
	const answer = await rosterAnswer(session, ctx);
	if (answer.kind === "held") return stateOfHeld(answer.held, standingOf(standing));
	if (answer.kind === "unknown") return standingOf(standing);
	return standing?.ok === false ? standingOf(standing) : undefined;
}

/** The one ask, so a thrown request is recorded like a refused one. */
async function ask(team: TeamJoin, ctx: ExtensionContext, input: TeamJoinInput): Promise<JoinResult> {
	try {
		return await team.join(ctx, input);
	} catch (error) {
		return { ok: false, error: messageOf(error) };
	}
}

/**
 * What a result says when the join behind it did not land.
 *
 * Both claim doors write the card first and join after it, so a refusal cannot undo the card —
 * what it can do is leave an owner nothing can address: a peer's `session send` to this label
 * is refused, and presence reads the owner as absent. The sentence is written once because the
 * tool and the round both print it, and it is a line on a result rather than an error for the
 * same reason the card is not undone.
 */
export function joinFailureLine(state: TeamState): string | undefined {
	if (!("error" in state)) return undefined;
	// The bus writes some of these as sentences and some as clauses; the fix is a sentence of its
	// own, so the reason gets a full stop before it rather than running into the next one.
	const reason = state.error.endsWith(".") ? state.error : `${state.error}.`;
	return state.fix === undefined ? `Not on the team: ${reason}` : `Not on the team: ${reason} ${state.fix}`;
}

/**
 * Whether the bus holds a live record for this session, and under which name.
 *
 * Two answers are not evidence against the standing, so both keep it rather than spend a
 * join on a guess: a host that reports no session id has no record to look for, and a
 * roster that cannot be read says nothing about the record it holds. Neither may throw —
 * this runs after a card was written, and a claim is not undone by a bus that would not say.
 */
async function rosterAnswer(session: JoinSession, ctx: ExtensionContext): Promise<RosterAnswer> {
	const id = sessionIdOf(ctx);
	if (id === undefined) return { kind: "unknown" };
	let roster: RosterSession[] | undefined;
	try {
		roster = await session.roster(ctx.cwd);
	} catch {
		return { kind: "unknown" };
	}
	const record = roster?.find((entry) => entry.id === id);
	if (record === undefined || rosterStateOf(record, session.now()) !== "live") return { kind: "absent" };
	return {
		kind: "held",
		held: {
			label: record.label,
			...(record.watching === undefined ? {} : { watching: record.watching }),
			...(record.pid === undefined ? {} : { pid: record.pid }),
		},
	};
}

/**
 * The join to ask for, repeating the choice already made: the bus's record first, because a
 * re-ask through a door this process never asked still must not arm mail the user turned off,
 * and the standing after it, for a record the bus no longer holds.
 *
 * `armed: false` is the user's `join({listen: false})`, not a failure to repair, so the ask is
 * the same disarmed join. A watch that was armed is asked for with the wake it had, so a
 * session woken for its mail stays woken. Neither says anything, and the ask is a plain join.
 */
function askAgain(standing: JoinResult | undefined, label: string, watching?: Watching): TeamJoinInput {
	const choice = watching ?? (standing?.ok === true ? standing.watching : undefined);
	if (choice === undefined) return { label };
	if (!choice.armed) return { label, listen: false };
	return choice.wake ? { label, wake: true } : { label };
}
