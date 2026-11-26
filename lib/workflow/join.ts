/**
 * Membership: who is on the team, how a session gets on it, and which tools that offers.
 *
 * Three questions, one fact. `onTeam` reads the bus's own record for this session's id and
 * answers yes or no; `joinTeam` puts a session on the team, and the doors that mean to are the
 * ones that ask it — `/team join` (the one door that renames, because a typed label is a
 * rename), `/board` serving the seat, and the bus's own `session join`. Every other door asks
 * `onTeam` first, so a card is claimed inside a team or not at all. `createMemberTools` spends
 * the same fact on the model's tool list: the tool a session is offered exists while it is on
 * the team and is absent while it is not.
 *
 * Being on the team is read from the bus's record, never from the standing alone: a standing
 * says a join once answered `ok`, and stays true after the bus stops, after the TTL prunes the
 * record, and after a `/resume` takes the seat over — so a claim that trusted it would write a
 * card under a name no peer resolves. The roster is that same question asked of the files,
 * which is what the round already reads.
 *
 * A join that did not land is a `TeamState` carrying the reason and, when one is known, what a
 * reader can do about it — the bus's sentence says what happened and never what to do, and the
 * door every other sentence names is the wrong advice in two of the three cases.
 *
 * The asking is shared because the rule around it is easy to get different in two places: ask
 * only while this session is not on the team, or is on it with a record that cannot promise the
 * wake — an armed watch that cannot wake it, or a record written before the field existed — so a
 * card write costs one request per session rather than one per card.
 *
 * The record is also the only word on *which* name the bus holds, and that is why a join asks
 * when the label differs: the page serves as the seat, so opening it renames a session that
 * held another name, while a session already seated asks nothing.
 *
 * `lib/` is value-only, so the session and the join arrive as parameters, exactly as the store
 * does for the tools — and `createMemberTools` keeps its per-process memory in its own closure,
 * never in a module variable.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { messageOf } from "../errors.ts";
import { sameLabel, sessionIdOf } from "../session-label.ts";
import { type RosterSession, type RosterState, rosterStateOf } from "../session-roster.ts";
import {
	busLoaded,
	type JoinResult,
	NO_BUS_ERROR,
	type TeamJoin,
	type TeamJoinInput,
	type Watching,
} from "../session-tool.ts";
import { startTokenOf } from "../spawn.ts";
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

/** What one live record says: the name it holds and the watch the bus last wrote for it. */
interface Held {
	label: string;
	watching?: Watching;
}

/**
 * The roster's answer about this session: a live record, no record, or no word at all.
 *
 * `absent` and `unknown` are different facts — a bus that has not recorded this session is
 * a join to spend, while a roster that cannot be read is no evidence either way — and they
 * are kept apart for the same reason `lib/session-roster.ts` says a missing directory is not
 * an error: a guess either way would be a write under a name nothing backs. `unknown` says
 * which fact it is, because the two are owed different answers: a host with no session id
 * has no record to look for at all, while a roster that would not read is a record this
 * door could still be held to.
 */
type RosterAnswer =
	| { kind: "held"; held: Held; here: boolean }
	| { kind: "absent" }
	| { kind: "unknown"; why: "no-session-id" | "unreadable" };

/** A state from a live record, with the standing filling in a listening fact it cannot say. */
function stateOfHeld(held: Held, known: TeamState | undefined): TeamState {
	const listening = held.watching?.armed ?? (known !== undefined && "label" in known ? known.listening : undefined);
	return listening === undefined ? { label: held.label } : { label: held.label, listening };
}

/**
 * Whether a live record is this process's own, which is the half a label cannot tell.
 *
 * A second pane opened on the same session id writes its own record, so a peer is reachable
 * and the label is right, but the watch is the other pane's: asking here is what arms this
 * pane's mail, the way the page did before a join learned to ask once. Three facts decide it.
 * Another machine's pid names a local process by coincidence, so a foreign record is never
 * this one. A record naming no process is judged by its name alone, since there is nothing
 * else to compare. And a record naming this pid is ours only while its start token still
 * matches: a pid the machine reused belongs to another process now, and the read settles that
 * only once a record is quiet, so a live one has to be asked here.
 */
function ownRecord(record: Pick<RosterSession, "pid" | "startToken" | "foreign">): boolean {
	if (record.foreign === true) return false;
	if (record.pid === undefined) return true;
	if (record.pid !== process.pid) return false;
	return record.startToken === undefined || record.startToken === startTokenOf(record.pid);
}

/**
 * Put this session on the team, unless the bus already holds it here, under the name asked for.
 *
 * The live record decides, and the standing only fills in when the record cannot be read:
 * a session the bus holds under this name is on the team whatever this process remembers,
 * and one it holds under another name is renamed — which is how opening the page takes the
 * seat. A record under the name asked for is also the only evidence of a watch the user
 * turned off, so a rename repeats *its* choice rather than arming mail afresh — and an armed
 * watch without wake is the one state a team door upgrades.
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
	if (answer.kind === "held" && answer.here && sameLabel(answer.held.label, label)) {
		// A record that answers for its own watch is one fact: armed-and-waking needs no request, and
		// `armed: false` is the user's `listen: false`, which a team door never turns back on. A
		// record that says nothing is not a third answer but no answer yet — the boot write lands
		// before any join writes the field — so the door asks, and `askAgain` repeats a disarmed
		// standing while asking for wake otherwise.
		const watch = answer.held.watching;
		if (watch !== undefined && (watch.armed !== true || watch.wake))
			return stateOfHeld(answer.held, standingOf(standing));
	}
	// No word from the bus keeps a standing that landed, with one exception. A host with no session
	// id has no record to look for at all, and a standing under another name is the one a guess
	// could rename — both keep what landed. A roster that would not read, under the very name being
	// asked for, is the case this door must still spend: it cannot rename anything, and the standing
	// cannot promise the watch this join exists to check.
	if (answer.kind === "unknown" && standing?.ok === true) {
		if (answer.why === "no-session-id" || !sameLabel(standing.label, label)) return standingOf(standing);
	}
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
 * Whether the bus holds a live record of this session: the membership fact, and the only one.
 *
 * A pure read of the roster — the answer is what the files say, not what a join once answered —
 * so it costs no request and can be asked at every turn. `absent` is every way of not being on
 * the team: no record, a record whose heartbeat aged out, a host with no session id, and a
 * roster that would not read. None of them is a member, and none of them throws.
 */
export async function onTeam(session: JoinSession, ctx: ExtensionContext): Promise<boolean> {
	return (await rosterAnswer(session, ctx)).kind === "held";
}

/**
 * What a door says when the gate refuses: no record, nothing written, and where to go.
 *
 * One sentence for the four ways of not being on the team, because the guard cannot tell them
 * apart without spending a request, and a refusal that guessed would accuse the wrong thing. The
 * doors it names are the ones that join: `/team join` for a name of this session's own, `/board`
 * for the seat.
 */
export const NOT_ON_TEAM =
	"Not on the team: the session bus has no live record of this session. " +
	"Join with `/team join <label>`, or `/board` to serve the page as the seat.";

/**
 * Put one name in the active set, or take it out, leaving every other name where it is.
 *
 * Idempotent, and silent when the host already agrees: a `setActiveTools` call re-declares the
 * tool list to the model, so a sync that wrote every turn would spend a prompt delta on a state
 * that had not changed. `lib/tool-set.ts` owns the same surgery for a mode's whole set; this is
 * the one name a membership offer moves, kept beside its only caller.
 */
function setToolActive(host: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">, name: string, on: boolean): void {
	const active = host.getActiveTools();
	if (active.includes(name) === on) return;
	host.setActiveTools(on ? [...active, name] : active.filter((entry) => entry !== name));
}

/** What the model's tool list is offered, and how to keep it in step with the team. */
export interface MemberTools {
	/**
	 * Offer the names when this session is on the team, withdraw them when it is not.
	 *
	 * Called where a turn starts, and idempotent: it writes only when the state it wants differs
	 * from the one it last applied, so a user who removes a tool through `/tools` keeps it
	 * removed until their membership changes.
	 */
	sync(ctx: ExtensionContext): Promise<void>;
}

/** What a surface says about itself: the names it offers, and whether a run with no bus keeps them. */
export interface MemberToolsOptions {
	/**
	 * Offer the names even with no bus loaded: the board is a work list before it is a team, so a
	 * solo session keeps it. A team verb has no such answer — nothing can be handed over.
	 */
	solo: boolean;
}

/**
 * The tool a session is offered, as the team's own question: on it, or not.
 *
 * The one place the model's tool list is decided for these surfaces. It asks `onTeam` — never the
 * standing, and never a join — so availability is the same fact the doors gate on, and it keeps
 * the last state it applied in its own closure: a level-triggered write every turn would undo a
 * user's `/tools` choice, which is the trap the worktree's overrides already warn about.
 */
export function createMemberTools(
	pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools" | "getAllTools">,
	session: JoinSession,
	names: readonly string[],
	options: MemberToolsOptions,
): MemberTools {
	/** The state last written, so a turn that changes nothing writes nothing. */
	let offered: boolean | undefined;
	return {
		async sync(ctx) {
			const wanted = (options.solo && !busLoaded(pi)) || (await onTeam(session, ctx));
			if (wanted === offered) return;
			offered = wanted;
			for (const name of names) setToolActive(pi, name, wanted);
		},
	};
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
	if (id === undefined) return { kind: "unknown", why: "no-session-id" };
	let roster: RosterSession[] | undefined;
	try {
		roster = await session.roster(ctx.cwd);
	} catch {
		return { kind: "unknown", why: "unreadable" };
	}
	const record = roster?.find((entry) => entry.id === id);
	if (record === undefined || rosterStateOf(record, session.now()) !== "live") return { kind: "absent" };
	return {
		kind: "held",
		here: ownRecord(record),
		held: {
			label: record.label,
			...(record.watching === undefined ? {} : { watching: record.watching }),
		},
	};
}

/**
 * The join to ask for, repeating the choice already made: the bus's record first, because a
 * re-ask through a door this process never asked still must not arm mail the user turned off,
 * and the standing after it, for a record the bus no longer holds.
 *
 * `armed: false` is the user's `join({listen: false})`, not a failure to repair, so the ask is
 * the same disarmed join. A watch that is armed — with wake or without — is asked for with wake,
 * because a team door is how work reaches this session, and an armed watch that cannot wake it
 * still needs a human turn.
 */
function askAgain(standing: JoinResult | undefined, label: string, watching?: Watching): TeamJoinInput {
	const choice = watching ?? (standing?.ok === true ? standing.watching : undefined);
	if (choice !== undefined && !choice.armed) return { label, listen: false };
	return { label, wake: true };
}
