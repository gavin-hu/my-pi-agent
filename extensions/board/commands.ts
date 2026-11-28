/**
 * `/board` — the page's one entry point, and the lead's door to the two signs.
 *
 * `team` opens the page on the Team tab, `status` prints one line, `stop` closes the page and
 * stands the seat down with it, and `approve <id>` / `review <id>` sign the two gates while
 * `archive` folds finished cards away. All three are the lead's: the gate reads the label of the
 * session that typed the line, which is the lead's own whenever that session serves the page, and a
 * board naming no lead has nobody to read, so the person's sign is the one door it keeps. Everything
 * else opens the page. One row per word (`BOARD_WORDS`) carries its spelling, its sign and its flags,
 * so the help, the completer and the parser cannot spell the vocabulary differently; the lifecycle is
 * `page.ts`'s, so the idle grace and `session_shutdown` close this same server.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { ArtifactProof } from "../../lib/workflow/artifact.ts";
import { cardRef, normalizeCardId, type Card } from "../../lib/workflow/card.ts";
import type { Lead, Verification } from "../../lib/workflow/contract.ts";
import { isLead, personActor, type Sign, signMark } from "../../lib/workflow/signs.ts";
import type { Actor, CardOp } from "../../lib/workflow/rules.ts";
import { landedClause, ranClause } from "../../lib/workflow/round-text.ts";
import { plural } from "../../lib/format.ts";
import { type BoardSession } from "../../lib/workflow/session.ts";
import type { BoardStore, MutateResult } from "../../lib/workflow/store.ts";
import type { VerifyRun } from "../../lib/workflow/verify.ts";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { messageOf } from "../../lib/errors.ts";
import { createDeliver, createTeamJoin, type Deliver, type TeamJoin } from "../../lib/session-tool.ts";
import { type TeamState, teamLine } from "./join.ts";
import type { BoardPage, BoardPageStatus, StaleDrop } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** One flag a word accepts: its spelling, what it takes, and what a missing value says. */
export interface BoardFlag {
	/** The flag itself, lowercased: what the parser folds a typed flag to. */
	name: string;
	/** Whether it takes the next word, or owns the rest of the line. */
	arg: "value" | "rest";
	/** The value as the usage line spells it, and as the sentence refusing an empty one says it. */
	slot: string;
	needs: string;
}

/** One word `/board` accepts: how a user writes it, what may follow it, and what it does. */
export interface BoardWord {
	/** The word itself, lowercased: what the handler parses and the completer offers. */
	word: string;
	/** The sign, on the two words that write one — who are also the only words taking a card. */
	sign?: Sign;
	/** The flags it accepts; absent when it takes none, which refuses every flag by name. */
	flags?: readonly BoardFlag[];
	/** What the word does, given its row and the words that row's grammar read. */
	run: Runner;
}

/** The flags this build has, each written once: `--older-than <age>`, `--root <tree>`, `--override <why>`. */
const AGE_FLAG: BoardFlag = { name: "--older-than", arg: "value", slot: "<age>", needs: "an age — 30d, 12h, 90m" };
const ROOT_FLAG: BoardFlag = { name: "--root", arg: "value", slot: "<tree>", needs: "a tree" };
const OVERRIDE_FLAG: BoardFlag = { name: "--override", arg: "rest", slot: "<why>", needs: "the one line saying why" };

/** A line's words, once its row has read them: the card, the flags, and what nothing claimed. */
export interface WordParse {
	/** The card a sign names, folded to lowercase; absent when the line names none. */
	card?: string;
	/** The row's flags, by name, each with the value it was given. */
	flags: ReadonlyMap<string, string>;
	/** Words nothing claimed: a stray token, or a card on a word that takes none. */
	extra: readonly string[];
}

/**
 * Read a word's tail against its row: the card, the flags, and what nothing claimed. One pass, because
 * a flag's value is the word after it and `--override` owns the rest of the line. A flag the row does
 * not declare is refused by name rather than read as a card or silently dropped, which is what a
 * hand-counted scan does to `/board review 4 --rote x`.
 */
function parseWords(
	row: BoardWord,
	words: readonly string[],
): { ok: true; parsed: WordParse } | { ok: false; error: string } {
	const flags = new Map<string, string>();
	const extra: string[] = [];
	let card: string | undefined;
	for (let at = 0; at < words.length; at += 1) {
		const token = words[at] ?? "";
		const name = token.toLowerCase();
		if (!name.startsWith("--")) {
			// The card is the first bare word on a sign; any other bare word is one nothing takes.
			if (row.sign !== undefined && card === undefined) card = name;
			else extra.push(token);
			continue;
		}
		const flag = row.flags?.find((entry) => entry.name === name);
		if (flag === undefined) return { ok: false, error: refuseFlag(row, name) };
		const value = flag.arg === "rest" ? words.slice(at + 1).join(" ") : words[at + 1];
		if (value === undefined || value === "" || value.startsWith("--")) {
			return { ok: false, error: `${row.word} ${name} needs ${flag.needs}` };
		}
		flags.set(name, value);
		if (flag.arg === "rest") break;
		at += 1;
	}
	return { ok: true, parsed: { ...(card === undefined ? {} : { card }), flags, extra } };
}

/** The refusal a flag the word does not declare gets: the flags it does have, or the word's usage. */
function refuseFlag(row: BoardWord, name: string): string {
	const flags = row.flags ?? [];
	if (flags.length === 0) return `${row.word} takes no ${name} — it takes none: ${usageOf(row)}`;
	return `${row.word} takes no ${name} — try ${flags.map(writtenOf).join(", ")}`;
}

/** The whole line refusing words the row does not take — where the parser's errors are fragments. */
function extraRefusal(row: BoardWord): string {
	return `board: ${row.word} takes ${row.sign === undefined ? "no words" : "one card"} — try ${usageOf(row)}`;
}

function writtenOf(flag: BoardFlag): string {
	return `${flag.name} ${flag.slot}`;
}

function cardSlotOf(row: BoardWord): string {
	return row.sign === undefined ? "" : " <id>";
}

function spelledOf(row: BoardWord): string {
	const flags = (row.flags ?? []).map(writtenOf).join(" ");
	return `${row.word}${cardSlotOf(row)}${flags === "" ? "" : ` ${flags}`}`;
}

function usageOf(row: BoardWord): string {
	return `/board ${spelledOf(row)}`;
}

/**
 * The usage line the description carries: every word with its flags, the one surface with room for
 * them. The mistype warning answers a different question, so `wordHelp` keeps the short form.
 */
function usageLine(): string {
	return `/board [${BOARD_WORDS.map(spelledOf).join(" | ")}]`;
}

/** The words a mistyped word is corrected with: the word and its card slot, never its flags. */
function wordHelp(): string {
	return BOARD_WORDS.map((row) => `/board ${row.word}${cardSlotOf(row)}`).join(", ");
}

/** A line for the person, and the tone it is shown in: a failure is not the same news as a sign. */
type Line = { text: string; tone: "info" | "warning" | "error" };

/** Tell the person one line, in the tone it is news in. */
function say(ctx: ExtensionCommandContext, line: Line): void {
	ctx.ui.notify(line.text, line.tone);
}

/**
 * The seat's two moves, as the command needs them: taking it when the page it just
 * served is this session's own, and leaving it. Both live in `index.ts`, which is
 * where the runtime is loaded on first use — the command stays a parser.
 */
export interface LeadDoor {
	enter(ctx: ExtensionCommandContext): Promise<void>;
	exit(ctx: ExtensionCommandContext): Promise<boolean>;
}

/** Everything a word acts on: the page, the session behind it, and the doors the caller handed in. */
interface Door {
	pi: ExtensionAPI;
	session: BoardSession;
	page: BoardPage;
	team: TeamJoin;
	notify?: Deliver;
	verify?: VerifyRun;
	lead?: LeadDoor;
}

/** What one word does, given its row and the words that row's grammar read. */
type Runner = (door: Door, ctx: ExtensionCommandContext, row: BoardWord, parsed: WordParse) => Promise<void>;

const runNext: Runner = async (door, ctx, _row, parsed) => {
	// The boundary is this session's own: what it still holds is the one fact that decides whether
	// a fresh transcript is a start or an escape. A `blocked` card is parked by somebody else's
	// decision, so it does not hold the door — and can say so on the next session's own line.
	if (parsed.extra.length > 0) return say(ctx, { text: NEXT_TAKES_NO_CARD, tone: "warning" });
	const refusal = nextRefusal(await heldOrFailure(door.session, ctx));
	if (refusal !== undefined) return say(ctx, { text: refusal, tone: "warning" });
	// A replacement mid-stream is the one call whose order the host documents: waiting first is
	// what `rewind` does before it replaces a view, and a command is the door this is safe at.
	if (!ctx.isIdle()) await ctx.waitForIdle();
	const { cancelled } = await ctx.newSession();
	if (cancelled) say(ctx, { text: NEXT_CANCELLED, tone: "warning" });
};

const runArchive: Runner = async (door, ctx, row, parsed) => {
	// The lead's door to the sweep the tool already had: one rule for both, so the count the
	// rollup prints and the cards this moves cannot be two sets. The flag is read before the
	// store is even opened, because a spec a person mistyped must not reach a sweep that would
	// take every finished card.
	if (parsed.extra.length > 0) {
		return say(ctx, {
			text: `board: archive takes ${writtenOf(AGE_FLAG)} and nothing else. Nothing was swept.`,
			tone: "warning",
		});
	}
	const { boundOf, sweepFinished, sweepText } = await import("./archive.ts");
	const read = boundOf(parsed.flags.get(AGE_FLAG.name));
	if (!read.ok) return say(ctx, { text: `board: ${read.error}`, tone: "warning" });
	// The sweep writes as the session that asked for it, by the same rule the two signs follow:
	// the lead's own label, or the person's when the board names no lead to write as.
	const write = await leadWrite(door, ctx, row.word);
	if ("refused" in write) return say(ctx, { text: `board: ${write.refused}`, tone: "warning" });
	const swept = await sweepFinished(write.store, write.actor, door.session.now(), undefined, read.bound);
	say(ctx, { text: `board: ${sweepText(swept)}`, tone: swept.failed.length > 0 ? "warning" : "info" });
};

/** The one door the two signs share: a factory, so `signLine` is handed a `Sign` and not a row. */
function runSign(sign: Sign): Runner {
	return async (door, ctx, _row, parsed) => {
		say(ctx, await signLine(door, ctx, sign, parsed));
	};
}

const runStatus: Runner = async (door, ctx, row, parsed) => {
	if (parsed.extra.length > 0) return say(ctx, { text: extraRefusal(row), tone: "warning" });
	// The bus's record answers first: a disarm through `/session join` never reaches this
	// session, so the remembered standing is only the answer when the bus cannot give one.
	const { teamStatus } = await import("../../lib/workflow/join.ts");
	say(ctx, { text: statusLine(await door.page.status(), await teamStatus(door.session, ctx)), tone: "info" });
};

const runExit: Runner = async (door, ctx, row, parsed) => {
	if (parsed.extra.length > 0) return say(ctx, { text: extraRefusal(row), tone: "warning" });
	// Reading the page first, and leaving the seat second: the seat is what the page implied, so
	// every ending below is one fact — this session serves nothing now, and the tools are back. The
	// word is `exit` because `/team exit` is the door that ends a standing: the page and the seat go
	// together, which is why the split this replaced (`exit` for the seat alone, `stop` for the page)
	// stays gone — a seat without its page is one state, not two words.
	const status = await door.page.status();
	const left = door.lead === undefined ? false : await door.lead.exit(ctx);
	const off = left ? " · lead mode off" : "";
	// A note nobody answers is not a page to leave for the next session to trip over:
	// it is dropped here, and the line says whose it was.
	if (status.stale === true) {
		const dropped = await door.page.dropStale(ctx);
		return say(ctx, { text: `${dropLine(dropped, status)}${off}`, tone: "info" });
	}
	// A page another session serves is that session's to stop, and saying whose it is is the answer.
	if (status.attached === true) {
		return say(ctx, {
			text: `board: nothing to stop here — ${status.seat} serves this repository on :${status.port}${off}`,
			tone: "info",
		});
	}
	const stopped = await door.page.stop();
	// The word is this session saying it serves nothing now: the page clears the seat too
	// when it closes itself (the idle grace), and both writes are the same fact.
	door.session.serve(undefined);
	say(ctx, { text: `${stopped ? "board: stopped" : "board: not running"}${off}`, tone: "info" });
};

const runTeam: Runner = async (door, ctx, row, parsed) => {
	if (parsed.extra.length > 0) return say(ctx, { text: extraRefusal(row), tone: "warning" });
	await openPage(door, ctx, "team");
};

/**
 * The words the command accepts, in the order a user is likely to want them: the two card verbs, the
 * two signatures, then the page's own. One table, four surfaces — the description, the mistyped-word
 * line, the completer and the parser — so a word is added once. A row's card slot is its `sign`.
 */
export const BOARD_WORDS: readonly BoardWord[] = [
	{ word: "next", run: runNext },
	{ word: "archive", flags: [AGE_FLAG], run: runArchive },
	{ word: "approve", sign: "approve", run: runSign("approve") },
	{ word: "review", sign: "review", flags: [ROOT_FLAG, OVERRIDE_FLAG], run: runSign("review") },
	{ word: "status", run: runStatus },
	{ word: "exit", run: runExit },
	{ word: "team", run: runTeam },
];

export function registerCommands(
	pi: ExtensionAPI,
	session: BoardSession,
	page: BoardPage,
	deps: { team?: TeamJoin; notify?: Deliver; verify?: VerifyRun; lead?: LeadDoor } = {},
): void {
	const door: Door = {
		pi,
		session,
		page,
		team: deps.team ?? createTeamJoin(pi),
		notify: deps.notify,
		verify: deps.verify,
		lead: deps.lead,
	};
	pi.registerCommand(BOARD_COMMAND, {
		description: `Open the shared board in a local browser, sign its two gates as the lead, take the lead's seat, or fold the finished cards away: ${usageLine()}`,
		getArgumentCompletions: (prefix: string) => {
			// Lowercased, because that is what the handler parses: `/board ST 4` signs, so `/board ST`
			// has to complete.
			const text = prefix.trimStart().toLowerCase();
			if (text.includes(" ")) return null;
			const items = BOARD_WORDS.filter((entry) => entry.word.startsWith(text)).map((entry) => entry.word);
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			// The word is folded so `/board ST 4` signs; everything after it is kept as typed, because
			// the one reason a sign can carry is the person's own sentence and not a lowercased one.
			const [first = "", ...rest] = args.trim().split(/\s+/);
			const word = first.toLowerCase();
			const row = BOARD_WORDS.find((entry) => entry.word === word);
			if (row === undefined) {
				if (word === "") return openPage(door, ctx, "board");
				const text = `board: "${word}" is not a word this command knows — try ${wordHelp()}`;
				return say(ctx, { text, tone: "warning" });
			}
			const read = parseWords(row, rest);
			if (!read.ok) return say(ctx, { text: `board: ${read.error}`, tone: "warning" });
			return row.run(door, ctx, row, read.parsed);
		},
	});
}

/**
 * The page's own door: serve it, or watch somebody else's, and say which on one line. The seat is set
 * from the page's answer and the join happens here, because opening the page is the lead's one action.
 */
async function openPage(door: Door, ctx: ExtensionCommandContext, view: "board" | "team"): Promise<void> {
	const started = await door.page.start(ctx, view);
	// A failed start has already said why. Otherwise the seat is set from the page's own answer.
	if (started.kind === "failed") return;
	// An attached start stands this session down: the page answers under the seat that serves
	// it, so this session's own seat is not one to keep. The seat is left before `serve` is
	// told nothing, so the door reads the seat it had rather than a page already gone.
	const stoodDown = started.kind !== "served" && door.lead !== undefined ? await door.lead.exit(ctx) : false;
	door.session.serve(started.kind === "served" ? started.seat : undefined);
	// The join is `lib/workflow/join.ts`'s one rule, loaded here so a session that never opens the
	// page pays nothing for it: it asks when the bus does not hold this session under the seat's
	// name, and repeats a disarmed watch as the disarmed join the user asked for.
	const { joinTeam } = await import("../../lib/workflow/join.ts");
	const joined = await joinTeam(door.session, door.team, ctx, (await door.session.who(ctx, ctx.cwd)).label);
	// The address is on the line because the browser is not the only way in: a machine
	// with no default browser prints it here, and a tab closed by mistake is one
	// command from being opened again.
	say(ctx, {
		text:
			started.kind === "attached"
				? `board: ${started.seat} is serving this repository on :${started.port} — viewing · open ${started.url}${teamLine(joined)}${stoodDown ? " · lead mode off" : ""}`
				: `board: ${started.seat} serving ${started.repo} on :${started.port} · open ${started.url}${teamLine(joined)}`,
		tone: "info",
	});
	// Serving the page is the seat: the page answers under this session's name, so
	// the pane takes the mode the name already implies. An `attached` start stands
	// the session down — someone else's page is serving — and leaves the seat it held.
	if (started.kind === "served" && door.lead !== undefined) {
		await door.lead.enter(ctx);
		say(ctx, { text: "lead mode on: sign and dispatch; /board exit to write.", tone: "info" });
	}
}

/**
 * Sign one of the card's two gates as the lead whose session typed the line.
 *
 * The write is the same `mutate` the tool uses, so the rules are the state machine's: an
 * `approve` outside `plan`, a `review` outside `execute`, an unknown id, a card already signed and
 * a card the signer holds are each refused with the sentence the tool would give. What this door
 * adds is the session, the one identity a keyboard has: the gate refuses a line typed where the
 * lead is not, and the sign is written as that session, so the card carries its name. A board
 * naming no lead writes as the person instead — the id no session can have — because it has no
 * lead to write as. The message that follows is the tool's too: a command cannot call a tool, so
 * `announce` sends by the request the bus answers.
 */
async function signLine(door: Door, ctx: ExtensionCommandContext, sign: Sign, parsed: WordParse): Promise<Line> {
	const override = parsed.flags.get(OVERRIDE_FLAG.name);
	const root = parsed.flags.get(ROOT_FLAG.name);
	/**
	 * The run a spot-check records, or the sentence that stops it.
	 *
	 * The read, the run and the words are `lib/workflow/verify.ts`'s: the tool's door asks the card the
	 * same question, and a person signing at a keyboard must get the same answer for the same card.
	 */
	const verifiedFor = async (
		store: BoardStore,
		cardId: string,
		actor: Actor,
	): Promise<{ verified: Verification } | { error: string } | undefined> => {
		const card = await store.read(cardId).catch(() => undefined);
		if (card === undefined) return undefined;
		const module = await import("../../lib/workflow/verify.ts");
		// The gate, the override and the run are `lib/workflow/verify.ts`'s, as the tool's door asks them:
		// a sign that would be refused starts no process, and the refusal stays the store's to give.
		return module.spotCheck({
			card,
			actor,
			lead: store.config().lead,
			override,
			// The tree the review names, or the session's own: `--root` is the card's worktree (or a checkout
			// at its commit) when the signer is not in it.
			cwd: root === undefined ? resolveEffectiveCwd(ctx.cwd) : resolve(resolveEffectiveCwd(ctx.cwd), root),
			run: door.verify ?? module.defaultVerifyRun(),
			now: () => door.session.now(),
			tree: module.treeOf(door.pi),
		});
	};
	const id = parsed.card === undefined ? undefined : normalizeCardId(parsed.card);
	if (id === undefined) return { text: `board: ${sign} needs a card id — try /board ${sign} 4`, tone: "info" };
	// The store is a repository read and a file write, and a command has nowhere else to report
	// what they throw: without this the person sees a raw command error instead of a line.
	let result: MutateResult;
	let store: BoardStore;
	let lead: string;
	let actor: Actor;
	try {
		// The gate before anything it gates: a sign typed where the lead is not costs no plan read and
		// starts no process. The session that serves the page is the lead, so the label read here is the
		// one a person writes under after `/board`.
		const write = await leadWrite(door, ctx, sign);
		if ("refused" in write) return { text: `board: ${write.refused}`, tone: "warning" };
		store = write.store;
		lead = write.lead;
		actor = write.actor;
		// An approval covers the plan the card names as well as its wording, so it is proved before
		// the write — the same proof the tool hands in, from the one module that reads it. A
		// spot-check needs none: the `done` move proves the plan then.
		const proof = sign === "approve" ? await import("./proof.ts") : undefined;
		const artifact = proof === undefined ? undefined : await proof.provedPlan(door.session, ctx.cwd, store, id);
		// The run rides the sign here too: this door is the person's, so it executes the command the
		// contract names exactly as the tool's does, through the one body both doors share.
		const evidence = sign === "review" ? await verifiedFor(store, id, actor) : undefined;
		if (evidence !== undefined && "error" in evidence) return { text: `board: ${evidence.error}`, tone: "info" };
		result = await store.mutate(id, signOp(sign, override, artifact, evidence?.verified), actor, door.session.now());
	} catch (error) {
		return { text: `board: ${sign} ${cardRef(id)} failed — ${messageOf(error)}`, tone: "error" };
	}
	if (!result.ok) return { text: `board: ${result.error}`, tone: "info" };
	const done = sign === "approve" ? "approved" : "reviewed";
	// The close is a review's fact and never an approval's, so the word decides whether the card is
	// asked at all: a card in plan that carries a review — a hand-edited file, since no path writes
	// one — must not put its reason on the line an approval prints.
	const how = sign === "review" && result.card.review?.byInstruction !== undefined ? " · closed by instruction" : "";
	// What ran is the one fact a person at a keyboard cannot see in the card: the sign's own words,
	// in the one sentence the tool's card and the page's dialog print.
	const evidence = ranClause(result.card.review?.verified) + landedClause(result.card.landed);
	// The name the sign records: the lead's own label on a gated write, and the person's pronoun only
	// on a board that names no lead to write as.
	const by = signMark(actor, lead).by;
	const text = result.changed
		? `board: ${cardRef(id)} ${done} by ${by}${how}${evidence}`
		: `board: ${cardRef(id)} is already ${done} by ${by}${how}${evidence}`;
	// The message is the tool's rule as well as its transport — `announce` on the result is what a
	// fresh stamp and an untold repeat both set, so this door re-sends a sign the owner never heard
	// exactly as the tool does. The sign's own signer may record it, which is why the actor the line
	// was written with is the one handed on: `announced` compares with `signedAs`.
	if (result.notice !== sign) return { text, tone: "info" };
	const { settleNotice } = await import("./notices.ts");
	// The message and the record are one body, shared with the tool's door, settled on the store this
	// line already opened: `announced` compares with the mark that sign carries.
	const settled = await settleNotice({
		store,
		card: result.card,
		kind: result.notice,
		lead,
		by,
		actor,
		ctx,
		deliver: door.notify ?? createDeliver(door.pi),
		at: door.session.now(),
		audience: { roster: () => door.session.roster(ctx.cwd), now: () => door.session.now() },
	});
	const clause = settled.line?.trim();
	return { text: clause === undefined ? text : `${text} · ${clause}`, tone: "info" };
}

/** The operation one `/board` line makes: the word, the reason it may carry, and the plan it proved. */
function signOp(
	sign: Sign,
	override: string | undefined,
	artifact: ArtifactProof | undefined,
	verified: Verification | undefined,
): CardOp {
	if (sign === "review") {
		const base = override === undefined ? { kind: "review" as const } : { kind: "review" as const, override };
		return verified === undefined ? base : { ...base, verified };
	}
	return { kind: "approve", ...(artifact === undefined ? {} : { artifact }) };
}

/** Who a write is made as, on the store the gate allowed it on. */
interface LeadWrite {
	store: BoardStore;
	lead: Lead;
	actor: Actor;
}

/**
 * Open the store for a word that writes, and answer whether this session may: the store, the lead the
 * board names, and the actor a line typed here is written as. One body for the sweep and the two
 * signs, because the order is the rule — the label is read before a plan is read or a process started,
 * and a second copy of that order is how two doors come to gate differently.
 */
async function leadWrite(
	door: Door,
	ctx: ExtensionCommandContext,
	word: string,
): Promise<LeadWrite | { refused: string }> {
	const store = await door.session.store(ctx.cwd);
	const lead = store.config().lead;
	const who = await door.session.who(ctx, ctx.cwd);
	const refused = leadDoor(word, who, lead);
	if (refused !== undefined) return { refused };
	return { store, lead, actor: lead === "" ? personActor() : who };
}

/**
 * Whether the session that typed the word may use the lead's door, or the line refusing it.
 *
 * The page's session is the lead — `/board` sets the seat from its own answer — so a sign or a sweep
 * typed there is the lead's, and one typed in any other session is somebody's else. A board that
 * names no lead has no door to check and keeps the person's sign, which is why an unset lead passes.
 * The sentence names the session, the lead and the message that reaches it, because the way out is
 * the lead's own keyboard rather than another spelling of the same word here.
 */
function leadDoor(word: string, who: Pick<Actor, "label">, lead: Lead): string | undefined {
	if (lead === "" || isLead(who, lead)) return undefined;
	return `/board ${word} is the lead's: this session is ${who.label} and team.lead is ${lead} — ask ${lead} with \`session send\``;
}

/** One line for `/board status`: the page this session serves, watches, or does not have. */
export function statusLine(status: BoardPageStatus, team?: TeamState): string {
	if (status.running) {
		const watching = plural(status.watchers ?? 0, "tab");
		return `board: ${status.seat} serving ${status.repo} on :${status.port} · ${watching} watching · ${status.where}${teamLine(team)}`;
	}
	if (status.stale === true) {
		return `board: watching ${status.seat} on :${status.port} — that note answers nobody; /board exit drops it${teamLine(team)}`;
	}
	if (status.attached === true) {
		return `board: watching ${status.seat} on :${status.port} — nothing to stop here${teamLine(team)}`;
	}
	// The team outlives the page: a session that claimed a card is on it with no page open, so
	// the line says which team this session is on whichever door put it there.
	return `board: not running — /board opens it${teamLine(team)}`;
}

/**
 * What `/board exit` says after it went to drop a note nobody answers.
 *
 * Only a page the probe found is called "answering": the other two answers are this session
 * watching nothing now, and a note it could not clear is one that is not there — the sentence
 * a stale note survived was the one that named a page this call had just proved dead.
 */
export function dropLine(dropped: StaleDrop, status: BoardPageStatus): string {
	if (dropped === "live") return `board: nothing to stop here — ${status.seat} is answering on :${status.port}`;
	if (dropped === "dropped") return `board: dropped ${status.seat}'s note for :${status.port} — it answered nobody`;
	return `board: nothing to stop here — ${status.seat}'s note for :${status.port} is already gone`;
}

/** The one failure a replacement can report, because the replacement is the thing that says nothing. */
export const NEXT_CANCELLED = "board: the new session was cancelled — nothing was replaced";

/** What a card typed after `next` gets: the boundary is the session's, not the word's. */
export const NEXT_TAKES_NO_CARD =
	"board: /board next takes no card — the session it starts finds yours on its first turn";

/**
 * What a boundary has to answer: the cards this session still holds, or a read that failed. One of
 * the two, because nothing else is a reason to refuse a new session.
 */
export type NextAsk = { unreadable: true } | { held: readonly Card[] };

/**
 * Why `/board next` will not start a session yet, or `undefined` when the boundary is clear.
 *
 * The gate is this session's own work: a card in `plan` or `execute` is one the transcript was still
 * holding, and a new one would be leaving rather than finishing. `blocked` is not that — it waits on
 * a person's decision, and the next transcript's first line names it, so refusing there would trap a
 * session on the one thing it cannot do itself. A board that could not be read is a refusal too,
 * since the check is what proves nothing is open; the line names the door that skips the check.
 */
export function nextRefusal(ask: NextAsk): string | undefined {
	if ("unreadable" in ask) {
		return "board: /board next could not read the board just now — nothing is proved about your cards; /new starts a session anyway";
	}
	const open = ask.held.filter((card) => card.lane === "plan" || card.lane === "execute");
	const first = open[0];
	if (first === undefined) return undefined;
	const named = open.map((card) => `${cardRef(card.id)} in ${card.lane}`).join(", ");
	return open.length === 1
		? `board: ${named} is still yours — close it, or \`board release ${first.id}\` to start fresh`
		: `board: ${named} are still yours — close each, or \`board release <id>\` to start fresh`;
}

/** The cards this session holds, or the answer that says the board could not be read for them. */
async function heldOrFailure(session: BoardSession, ctx: ExtensionCommandContext): Promise<NextAsk> {
	const { heldCards } = await import("./context.ts");
	const held = await heldCards(session, ctx);
	return held === undefined ? { unreadable: true } : { held };
}
