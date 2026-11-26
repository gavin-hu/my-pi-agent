/**
 * `/team` — the lead's round, printed.
 *
 * The Team tab is the same round with a mouse; a lead reading a TUI should not have to
 * open a browser to see what needs a decision, so the command prints the rollup the
 * tool returns, the work a dead owner left behind, and one line saying who is live. It
 * reads the cards and the bus's records and writes nothing: acting on the round is
 * `team`'s tool (`assign`, `offer`, `ask`) or `board`'s own verbs.
 *
 * `/team who` prints that grouping as rows — one per session, nothing elided — and a label narrows
 * it to the one session a lead asked about. Both read one grouping, `whoIsHere`, so the round's
 * closing count and the listing cannot disagree about who is here.
 *
 * `/team join` lives here too, and stays in this module: the entry's registration budget counts the
 * modules it loads, so a door of its own would cost a start for one command's words.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { addTeammate, type AddTeammateResult } from "../../lib/workflow/config.ts";
import { type Card, cardRef, holds } from "../../lib/workflow/card.ts";
import { buildRound, type RoundSummary } from "../../lib/workflow/round.ts";
import { formatRound, holdingLine, LEAD_ROUND, withLiveOwner } from "../../lib/workflow/round-text.ts";
import { plural } from "../../lib/format.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import {
	createTeamJoin,
	createTeamLeave,
	type JoinResult,
	type TeamJoin,
	type TeamJoinInput,
	type TeamLeave,
} from "../../lib/session-tool.ts";
import { type RosterSession, presenceOf, rosterStateOf } from "../../lib/session-roster.ts";
import { isTeammate, labelKey, sessionNameOf } from "../../lib/session-label.ts";
import {
	formatJoined,
	formatLeft,
	formatNotJoined,
	formatNotLeft,
	formatStillOn,
	joinNote,
	type LeaveBlocker,
} from "./format.ts";

/** The command's name, which is also the word a user types. */
export const TEAM_COMMAND = "team";

/**
 * The words the command accepts besides the round itself.
 *
 * `who` and `join` take a label, so the completer continues past either word; `help` prints
 * {@link TEAM_USAGE} instead of reading the board.
 */
export const TEAM_WORDS = ["who", "join", "exit", "help"] as const;

/** The words that take a label, so a completion continues into one and the usage says so. */
const LABEL_WORDS = new Set<string>(["who", "join"]);

/**
 * What the command does, in the words a reader needs after a typo.
 *
 * One block, printed by `help` and after an unknown word: the warning used to be a sentence of its
 * own, and a sentence that named both other words drifted from the description above it.
 */
export const TEAM_USAGE = [
	"team: the lead's round over the board's cards.",
	"  /team                  the round: who holds what, and what needs a decision",
	"  /team who [<label>]    who is here, one row per session; one session when a label is named",
	"  /team join [<label>]   join the team as <label>; a bare join keeps this session's name",
	"  /team exit            leave the team: drop this session's record and its claims",
	"  /team help             these words",
].join("\n");

/**
 * How many of the round's own lines print before it says how many it left out.
 *
 * The work a dead owner left behind and the closing count print on top of it: those are the reason
 * a lead reads the round, and cutting them to hold a number would be the wrong trade. The elision
 * counts the rollup alone, so "… N more" is a count a reader can act on, and it names the surface
 * that draws the rest. The count is the part of the round a reader can ask for whole: `/team who`.
 */
export const MAX_ROUND_LINES = 10;

export function registerCommands(
	pi: ExtensionAPI,
	session: BoardSession,
	deps: { team?: TeamJoin; leave?: TeamLeave } = {},
): void {
	const team = deps.team ?? createTeamJoin(pi);
	const leaving = deps.leave ?? createTeamLeave(pi);
	// The completer is given no command context, and `ExtensionAPI` carries no cwd, so the root it
	// reads is the one Pi hands the session here: a resumed session's cwd lives in its header rather
	// than in the process, so `process.cwd()` would name the wrong repository for a moved checkout.
	let root: string | undefined;
	pi.on("session_start", (_event, ctx) => {
		root = ctx.cwd;
	});
	pi.registerCommand(TEAM_COMMAND, {
		// The line and the guideline are the same sentence: `/team` is where a lead reads the round, and
		// `lib/workflow/round-text.ts` owns what it is called.
		description: `${LEAD_ROUND} \`/team who [<label>]\` names who is here; \`/team join [<label>]\` joins the team, and \`/team exit\` leaves it`,
		getArgumentCompletions: async (prefix: string) => {
			const [typedWord = "", ...rest] = prefix.trimStart().split(/\s+/);
			// The word is matched without case and written back as the word the command parses, because
			// the value replaces the argument: `/team W` has to land as `/team who …`, not `/team W …`.
			const word = typedWord.toLowerCase();
			if (rest.length === 0) {
				const items = TEAM_WORDS.filter((candidate) => candidate.startsWith(word));
				return items.length > 0
					? items.map((value) => ({ value: LABEL_WORDS.has(value) ? `${value} ` : value, label: value }))
					: null;
			}
			// A label is the argument both words take, and the names a bare join draws from are the ones
			// worth offering: `team.teammates` is that list. The label is the whole rest, because that is how
			// the handler joins its argument — a team name stated with a space in it completes rather than
			// ending the list at its second word. The store is memoized by root, so a keystroke opens it once
			// per session; a completion that cannot name a root offers nothing.
			if (!LABEL_WORDS.has(word) || root === undefined) return null;
			const typed = labelKey(rest.join(" "));
			// A store that cannot open is the same answer as no root, and it has to be given rather than
			// thrown: the editor awaits this with no catch, so a rejection here costs every later Tab in
			// the process its autocomplete. One failure is not the session's — the open is memoized
			// unremembered, so the next keystroke asks again.
			const store = await session.store(root).catch(() => undefined);
			if (store === undefined) return null;
			const names = store.config().teammates.filter((candidate) => labelKey(candidate).startsWith(typed));
			// The value is the whole argument and not the name: pi-tui replaces the argument text with it,
			// so a bare label deletes the word that asked for the list (`/team who ` would become
			// `/team gavin`, which this command then refuses).
			return names.length > 0 ? names.map((name) => ({ value: `${word} ${name}`, label: name })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [word = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (word === "join") {
				const label = rest.join(" ").trim();
				// A typed label is the one naming action: it is also Pi's session name, which is what
				// `/team join` is for. With no label the team names the session when it can — see
				// `unnamedJoin` — and the join renames nothing, because a name the file already lists is the
				// team's, not the user's.
				const asked: JoinAsk = label === "" ? await unnamedJoin(session, ctx) : typedJoin(label);
				// The bus arms `on` when a join asks no `wake`, and keeps an armed record's mode otherwise, so
				// the wake every `/team join` owes is asked once here, where no door can forget it.
				const joined = await team.join(ctx, { ...asked.input, wake: true });
				// The standing is the session's, not this command's: `/board status` reports the team
				// whichever door put it there, and a typed label is the one door that always asks.
				session.team.record(joined);
				// The bar draws a name only while the repository's team holds it, so the join that just
				// renamed this session is what puts that name on the list: otherwise the one door meant
				// to name the footer would leave the chip empty and say nothing about why.
				const named = joined.ok && label !== "" ? await nameTheBar(pi, ctx.cwd, joined.label) : undefined;
				ctx.ui.notify(
					joinedLine(joined, joinNote(named, asked.picked)),
					joined.ok && named?.ok !== false ? "info" : "warning",
				);
				return;
			}
			if (word === "exit") {
				const { text, level } = await leaveTeam(session, ctx, leaving);
				ctx.ui.notify(text, level);
				return;
			}
			if (word === "help") {
				ctx.ui.notify(TEAM_USAGE, "info");
				return;
			}
			if (word !== "" && word !== "who") {
				ctx.ui.notify(`team: "${word}" is not a word this command knows\n${TEAM_USAGE}`, "warning");
				return;
			}
			// One read serves both words: the round needs the cards and the roster, and so does the
			// listing — only what each prints differs. The roster is read as data, so a repository
			// with no bus prints the round and says nothing about who is here rather than failing.
			const store = await session.store(ctx.cwd);
			const [cards, roster] = await Promise.all([store.list(), session.roster(ctx.cwd)]);
			const now = session.now();
			ctx.ui.notify(
				word === "who" ? whoText(cards, now, roster, rest.join(" ").trim()) : roundText(cards, now, roster),
				"info",
			);
		},
	});
}

/**
 * `/team exit`: what still holds this session on the team, then the leave itself.
 *
 * Both refusals are read before the bus is asked, and each names the door that frees it. A card the
 * exit would strand is the first: a card whose owner the bus has no record of waits for a person,
 * because a peer may only take a quiet or gone owner's. The seat is the second: the next sign a
 * seated lead makes would put the session back on the bus the exit had just cleared.
 */
async function leaveTeam(
	session: BoardSession,
	ctx: ExtensionCommandContext,
	leave: TeamLeave,
): Promise<{ text: string; level: "info" | "warning" }> {
	const blockers = await leaveBlockers(session, ctx);
	if (blockers.length > 0) return { text: formatStillOn(blockers), level: "warning" };
	const left = await leave.leave(ctx);
	if (!left.ok) return { text: formatNotLeft(left.error), level: "warning" };
	// No label is a session that was already off the team: the answer the person asked for, and no
	// name to give up because it had none.
	if (left.label === undefined) return { text: formatNotJoined("nothing to leave"), level: "info" };
	return { text: formatLeft(left.label, left.released), level: "info" };
}

/** What holds this session on the team, each with the verb that frees it. */
async function leaveBlockers(session: BoardSession, ctx: ExtensionCommandContext): Promise<LeaveBlocker[]> {
	const me = await session.who(ctx, ctx.cwd);
	const blockers: LeaveBlocker[] = [];
	if (me.seat === true) {
		blockers.push({
			reason: "this session is serving the board's page",
			door: "/board stop — ends the page and the seat together.",
		});
	}
	const store = await session.store(ctx.cwd);
	for (const card of await store.list()) {
		if (card.lane === "done" || !holds(card, me)) continue;
		blockers.push({
			reason: `${cardRef(card.id)} ${card.lane} is yours`,
			door: `board release ${card.id} — with no record, only the lead can take it back.`,
		});
	}
	return blockers;
}

/** What a `/team join` asks the bus for, and the project name a bare one took when it took one. */
interface JoinAsk {
	input: TeamJoinInput;
	/** The `team.teammates` name this join picked; absent when it kept a name or drew one. */
	picked?: string;
}

/**
 * What a typed `/team join` asks for: the label it was given, and the rename that label is.
 *
 * The one naming action, so nothing here rests on the project's list: the join lands on what the
 * person typed, and `name` is what makes the footer say it too.
 */
function typedJoin(label: string): JoinAsk {
	return { input: { label, name: true } };
}

/**
 * What a bare `/team join` asks for: nothing, when Pi already names the session and the bus can
 * derive that; else the name this session answers to — the record a claim wrote, the seat, or the
 * first free name the project's team lists, and the drawn one only when that list can give none.
 *
 * That choice is `who`'s, so this door reads it rather than drawing a second copy: the list is asked
 * once more only to say where the name came from. A name the project lists is the team's, not the
 * user's, so `name` is never set here: only a typed label is meant to rename the footer.
 */
async function unnamedJoin(session: BoardSession, ctx: ExtensionCommandContext): Promise<JoinAsk> {
	if ((sessionNameOf(ctx) ?? "").trim() !== "") return { input: {} };
	const who = await session.who(ctx, ctx.cwd);
	// The store's own team, because that is the list `who` drew from: a fresh read could name a team
	// the draw never saw. A store that will not open leaves the note off rather than failing a join.
	const team = await session.store(ctx.cwd).then(
		(store) => store.config().teammates,
		() => undefined,
	);
	const picked = isTeammate(who.label, team ?? []) ? who.label : undefined;
	return { input: { label: who.label }, ...(picked === undefined ? {} : { picked }) };
}

/**
 * Put the name this join made onto the team, then tell a bar to re-read it.
 *
 * The channel is the one load deferred to this door: the board's config is already paid by the store
 * this command reads, while the event name is not on the start path at all. It is emitted only for a
 * write that changed something — a bar re-reading an unchanged team is work for no name — and only
 * after the write, because the bar reads the file.
 */
async function nameTheBar(pi: ExtensionAPI, cwd: string, label: string): Promise<AddTeammateResult> {
	const { TEAM_CHANGED_CHANNEL } = await import("../../lib/events.ts");
	// The team lives in the repository's settings, not in the tree the shell sits in: a worktree's
	// `.pi/bytefly.json` is not tracked, so a join written there would name a teammate nothing reads.
	const { settingsRootFor } = await import("../../lib/repo-key.ts");
	const named = addTeammate(cwd, label, { root: await settingsRootFor(pi, cwd) });
	if (named.ok && named.changed) pi.events.emit(TEAM_CHANGED_CHANNEL, { cwd });
	return named;
}

/**
 * `/team join`'s line: who this session is on the team, what the bar will draw, or why it is on
 * none.
 */
export function joinedLine(result: JoinResult, note?: string): string {
	if (!result.ok) return formatNotJoined(result.error);
	return formatJoined(result.label, result.watching, note);
}

/**
 * The round as the lines a lead reads: the rollup, then a count of who is live.
 *
 * Capped, because a notify is a message and not a screen: past its limit the round says how many
 * lines it left out and which surface draws the rest, instead of pushing the session up the screen.
 * The tail is a count and a door, not the paragraph that named every session twice: the rows are
 * `/team who`'s.
 */
export function roundText(cards: readonly Card[], now: number, roster?: readonly RosterSession[]): string {
	if (cards.length === 0) return "team: nothing to report — the board is empty";
	// The name an owner is shown by is the one the bus holds now, resolved before anything groups
	// or compares labels: a rename moves the record and no card, and the rollup, the stalled lines,
	// and the presence line all speak of owners by their label.
	const named = cards.map((card) => withLiveOwner(card, roster));
	const round = buildRound(named, now);
	// The cap covers the rollup: what a dead owner left, and who is here at all, follow it whole.
	const lines = formatRound(named, round, roster).split("\n");
	const shown = lines.slice(0, MAX_ROUND_LINES);
	if (lines.length > MAX_ROUND_LINES) {
		shown.push(`… ${plural(lines.length - MAX_ROUND_LINES, "line")} more — /board draws the whole round`);
	}
	for (const line of stalledLines(named, roster, now)) shown.push(line);
	// The tail is the count a reader can ask for whole as `/team who`, so both read one grouping:
	// `presenceGroups` is the only place this module asks `rosterStateOf`.
	const who =
		roster === undefined || roster.length === 0
			? undefined
			: presenceTail(presenceGroups(round, roster, now), roster.length);
	if (who !== undefined) shown.push(who);
	return shown.join("\n");
}

/**
 * The four states, in the order they print, with the word each one heads.
 *
 * `who` heads its sections with these words and `who <label>` answers with the one its row belongs
 * to, so the word a reader meets in a listing and in a single answer cannot drift apart.
 */
const SECTIONS: ReadonlyArray<{ state: keyof WhoIsHere; head: string }> = [
	{ state: "live", head: "live" },
	{ state: "quiet", head: "quiet" },
	{ state: "absent", head: "not on the bus" },
	{ state: "gone", head: "gone" },
];

/**
 * `/team who [<label>]`: the same grouping as rows, uncapped and one session per row.
 *
 * `/team` is a notify whose cap decides what a reader sees, and a paragraph that names a session
 * under its state and again under `not listening` is the shape that answers this badly. Rows answer
 * it — who is here, and what each is holding — so no line is elided and every state prints,
 * `- none` included: a group a reader has to infer from its absence is the one that gets forgotten.
 * A label asks the same grouping about one session, an owner the bus has no record of included.
 */
export function whoText(cards: readonly Card[], now: number, roster?: readonly RosterSession[], label = ""): string {
	// A bus directory that does not exist is a fact, not an empty board: nobody has joined, so there
	// is nobody to list, and a word that printed nothing would look broken.
	if (roster === undefined) return "team: no session bus on this repository — nobody has joined";
	const here = whoIsHere(cards, now, roster);
	if (label !== "") {
		const asked = labelKey(label);
		for (const { state, head } of SECTIONS) {
			const row = here[state].find((candidate) => labelKey(candidate.label) === asked);
			if (row !== undefined) return `team: ${row.line} · ${head}${row.silent ? " · not listening" : ""}`;
		}
		return `team: no session or owner named "${label}" — /team who lists who is here`;
	}
	return [
		`team: ${plural(roster.length, "session")} on the bus`,
		...SECTIONS.flatMap(({ state, head }) => section(head, here[state])),
	].join("\n");
}

/** One state's rows: its head counts, and an empty group says so rather than vanishing. */
function section(label: string, rows: readonly PresenceRow[]): string[] {
	const head = `${label} (${rows.length})`;
	if (rows.length === 0) return [head, "- none"];
	return [head, ...rows.map((row) => `- ${row.line}${row.silent ? " · not listening" : ""}`)];
}

/**
 * The cards a lead can take back, as the line that says who from.
 *
 * One line per owner whose record says it has stopped, naming every unfinished card it holds —
 * including one that waits on another, since the board's dependency rule refuses a claim and a move
 * but `reclaim` is neither. Quiet is here because the rule lets a peer take a quiet owner's card.
 * An owner the bus has no record of is not: a live session that never joined writes no record
 * either, so the presence line states that as a fact instead of offering the verb.
 *
 * The verb the line prints is `board`'s, and it names it: `/team` writes nothing, and a bare
 * `reclaim` here would send a lead to a tool that no longer has one.
 */
function stalledLines(cards: readonly Card[], roster: readonly RosterSession[] | undefined, now: number): string[] {
	if (roster === undefined) return [];
	const byOwner = new Map<string, { label: string; state: "quiet" | "gone"; refs: string[] }>();
	for (const card of cards) {
		if (card.owner === undefined || card.lane === "done") continue;
		const state = presenceOf(roster, card.owner, now);
		if (state !== "quiet" && state !== "gone") continue;
		const key = labelKey(card.owner.label);
		const entry = byOwner.get(key) ?? { label: card.owner.label, state, refs: [] };
		entry.refs.push(cardRef(card.id));
		byOwner.set(key, entry);
	}
	return [...byOwner.values()].map(({ label, state, refs }) => {
		const why = state === "gone" ? "is not running" : "has gone quiet";
		return `board reclaim ${refs.join(", ")} — ${label} ${why}`;
	});
}

/** One session as both listings print it. */
export interface PresenceRow {
	label: string;
	/** `billing-core — #4 execute`, from `holdingLine`: the phrase both words print. */
	line: string;
	/** Its record says `watching.armed === false`, so mail waits for its next turn. */
	silent: boolean;
}

/** Who is here, grouped by what a lead does about it. */
export interface WhoIsHere {
	live: PresenceRow[];
	quiet: PresenceRow[];
	gone: PresenceRow[];
	/** Owners the board names, the bus has no record of, holding live cards. */
	absent: PresenceRow[];
}

/**
 * Who is here, from the round and the bus: the one grouping both words print.
 *
 * The owner groups are where the board already decided which label a card belongs to, so a
 * session's holding is the one its rollup line counted. `rosterStateOf` is asked here and nowhere
 * else in this module, so the tail and the listing cannot read one record two ways.
 */
function presenceGroups(round: RoundSummary, roster: readonly RosterSession[], now: number): WhoIsHere {
	const held = new Map(round.owners.map((group) => [labelKey(group.label), group.cards] as const));
	const row = (label: string, silent = false): PresenceRow => ({
		label,
		line: holdingLine(label, held.get(labelKey(label)) ?? []),
		silent,
	});
	const here: WhoIsHere = { live: [], quiet: [], gone: [], absent: [] };
	const recorded = new Set(roster.map((record) => labelKey(record.label)));
	for (const record of roster) {
		const state = rosterStateOf(record, now);
		if (state === "gone") here.gone.push(row(record.label));
		else if (state === "live") here.live.push(row(record.label, record.watching?.armed === false));
		else here.quiet.push(row(record.label));
	}
	// The owners the bus holds no record of, as the board knows them: only the ones holding work are
	// worth a row, because an owner holding nothing is history and `formatRound` folds it.
	here.absent = round.owners
		.filter((group) => group.cards.length > 0 && !recorded.has(labelKey(group.label)))
		.map((group) => row(group.label));
	return here;
}

/**
 * The same grouping, from the cards alone: the door `/team who` and this module's suite read.
 *
 * One body with {@link presenceGroups}, so a case that compares the two surfaces against it is
 * comparing both to the grouping they actually print rather than to a restatement of its names.
 */
export function whoIsHere(cards: readonly Card[], now: number, roster: readonly RosterSession[]): WhoIsHere {
	const named = cards.map((card) => withLiveOwner(card, roster));
	return presenceGroups(buildRound(named, now), roster, now);
}

/**
 * The line `/team` closes with: `2 of 4 sessions live — /team who lists them`.
 *
 * A count and a door rather than a sentence per state. The old paragraph repeated a session under
 * its state and again under `not listening:` and wrapped into a wall on any narrow terminal, and
 * the part of it a lead acted on — `board reclaim …` for a dead owner's cards — already prints
 * above this line. What is left is the one number a lead cannot read elsewhere: how much of the
 * bus is live, which is who a card can be handed to now.
 */
function presenceTail(here: WhoIsHere, total: number): string {
	return `${here.live.length} of ${plural(total, "session")} live — /team who lists them`;
}
