/**
 * `/board` — the page's one entry point, and the lead's door to the two signs.
 *
 * `team` opens the page on the Team tab, `status` prints one line, `stop` closes the page and
 * stands the seat down with it, and `approve <id>` / `review <id>` sign the two gates while
 * `archive` folds finished cards away. All three are the lead's: the gate reads the label of the
 * session that typed the line, which is the lead's own whenever that session serves the page, and a
 * board naming no lead has nobody to read, so the person's sign is the one door it keeps. Everything
 * else opens the page. The command is a thin parser — the lifecycle is `page.ts`'s, the transitions
 * are `lib/workflow/steps.ts`'s — so the idle grace and `session_shutdown` close the same server
 * this opens.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { ArtifactProof } from "../../lib/workflow/artifact.ts";
import { cardRef, normalizeCardId, type Card } from "../../lib/workflow/card.ts";
import type { Lead } from "../../lib/workflow/contract.ts";
import { isLead, personActor, type Sign, signMark, signOf } from "../../lib/workflow/signs.ts";
import type { Verification } from "../../lib/workflow/contract.ts";
import type { Actor, CardOp } from "../../lib/workflow/rules.ts";
import { landedClause, ranClause } from "../../lib/workflow/round-text.ts";
import { plural } from "../../lib/format.ts";
import { type BoardSession } from "../../lib/workflow/session.ts";
import type { BoardStore, MutateResult } from "../../lib/workflow/store.ts";
import type { VerifyRun } from "../../lib/workflow/verify.ts";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { messageOf } from "../../lib/errors.ts";
import { createDeliver, createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import type { Deliver } from "../../lib/session-tool.ts";
import { type TeamState, teamLine } from "./join.ts";
import type { BoardPage, BoardPageStatus, StaleDrop } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** The words the command accepts, in the order a user is likely to want them. */
const BOARD_WORDS = ["next", "archive", "approve", "review", "status", "stop", "team"] as const;

/**
 * The seat's two moves, as the command needs them: taking it when the page it just
 * served is this session's own, and leaving it. Both live in `index.ts`, which is
 * where the runtime is loaded on first use — the command stays a parser.
 */
export interface LeadDoor {
	enter(ctx: ExtensionCommandContext): Promise<void>;
	exit(ctx: ExtensionCommandContext): Promise<boolean>;
}

export function registerCommands(
	pi: ExtensionAPI,
	session: BoardSession,
	page: BoardPage,
	deps: { team?: TeamJoin; notify?: Deliver; verify?: VerifyRun; lead?: LeadDoor } = {},
): void {
	const team = deps.team ?? createTeamJoin(pi);
	pi.registerCommand(BOARD_COMMAND, {
		description:
			"Open the shared board in a local browser, sign its two gates as the lead, take the lead's seat, or fold the finished cards away: /board [next | archive [--older-than <age>] | team | status | stop | approve <id> | review <id> [--root <tree>] [--override <why>]]",
		getArgumentCompletions: (prefix: string) => {
			// Lowercased, because that is what the handler parses: `/board ST 4` signs, so `/board ST`
			// has to complete.
			const text = prefix.trimStart().toLowerCase();
			if (text.includes(" ")) return null;
			const items = BOARD_WORDS.filter((word) => word.startsWith(text));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			// The word is folded so `/board ST 4` signs; everything after it is kept as typed, because
			// the one reason a sign can carry is the person's own sentence and not a lowercased one.
			const [first = "", ...rest] = args.trim().split(/\s+/);
			const word = first.toLowerCase();
			const sign = signOf(word);
			if (sign !== undefined) {
				const line = await signLine(pi, session, sign, rest, ctx, deps.notify, deps.verify);
				ctx.ui.notify(line.text, line.tone);
				return;
			}
			if (word === "archive") {
				// The lead's door to the sweep the tool already had: one rule for both, so the count the
				// rollup prints and the cards this moves cannot be two sets. The flag is read before the
				// store is even opened, because a spec a person mistyped must not reach a sweep that would
				// take every finished card.
				const { boundFromCommand, sweepFinished, sweepText } = await import("./archive.ts");
				const read = boundFromCommand(rest);
				if (!read.ok) {
					ctx.ui.notify(`board: ${read.error}`, "warning");
					return;
				}
				const store = await session.store(ctx.cwd);
				const lead = store.config().lead;
				// The sweep writes as the session that asked for it, by the same rule the two signs follow:
				// the lead's own label, or the person's when the board names no lead to write as.
				const who = await session.who(ctx, ctx.cwd);
				const refused = leadDoor(word, who, lead);
				if (refused !== undefined) {
					ctx.ui.notify(`board: ${refused}`, "warning");
					return;
				}
				const swept = await sweepFinished(
					store,
					lead === "" ? personActor() : who,
					session.now(),
					undefined,
					read.bound,
				);
				ctx.ui.notify(`board: ${sweepText(swept)}`, swept.failed.length > 0 ? "warning" : "info");
				return;
			}
			if (word === "status") {
				// The bus's record answers first: a disarm through `/session join` never reaches this
				// session, so the remembered standing is only the answer when the bus cannot give one.
				const { teamStatus } = await import("../../lib/workflow/join.ts");
				ctx.ui.notify(statusLine(await page.status(), await teamStatus(session, ctx)), "info");
				return;
			}
			if (word === "stop") {
				// Reading the page first, and leaving the seat second: the seat is what the page implied,
				// so every ending below is one fact — this session serves nothing now, and the tools are
				// back. Leaving the seat before `stop` is what `exit` used to be for; a seat without its
				// page is the one state that made a second word necessary, and it is gone.
				const status = await page.status();
				const left = deps.lead === undefined ? false : await deps.lead.exit(ctx);
				const off = left ? " · lead mode off" : "";
				// A note nobody answers is not a page to leave for the next session to trip over:
				// it is dropped here, and the line says whose it was.
				if (status.stale === true) {
					const dropped = await page.dropStale(ctx);
					ctx.ui.notify(`${dropLine(dropped, status)}${off}`, "info");
					return;
				}
				// A page another session serves is that session's to stop, and saying whose it is is the answer.
				if (status.attached === true) {
					ctx.ui.notify(
						`board: nothing to stop here — ${status.seat} serves this repository on :${status.port}${off}`,
						"info",
					);
					return;
				}
				const stopped = await page.stop();
				// The word is this session saying it serves nothing now: the page clears the seat too
				// when it closes itself (the idle grace), and both writes are the same fact.
				session.serve(undefined);
				ctx.ui.notify(`${stopped ? "board: stopped" : "board: not running"}${off}`, "info");
				return;
			}
			if (word === "next") {
				// The boundary is this session's own: what it still holds is the one fact that decides whether
				// a fresh transcript is a start or an escape. A `blocked` card is parked by somebody else's
				// decision, so it does not hold the door — and can say so on the next session's own line.
				const refusal =
					rest.length > 0 ? nextRefusal({ argued: rest[0] ?? "" }) : nextRefusal(await heldOrFailure(session, ctx));
				if (refusal !== undefined) {
					ctx.ui.notify(refusal, "warning");
					return;
				}
				// A replacement mid-stream is the one call whose order the host documents: waiting first is
				// what `rewind` does before it replaces a view, and a command is the door this is safe at.
				if (!ctx.isIdle()) await ctx.waitForIdle();
				const { cancelled } = await ctx.newSession();
				if (cancelled) ctx.ui.notify(NEXT_CANCELLED, "warning");
				return;
			}
			if (word !== "" && word !== "team") {
				ctx.ui.notify(`board: "${word}" is not a word this command knows — try ${wordHelp()}`, "warning");
				return;
			}
			const started = await page.start(ctx, word === "team" ? "team" : "board");
			// A failed start has already said why. Otherwise the seat is set from the page's own
			// answer — the page a session serves is a role, and every name this session writes and
			// is addressed by follows from it — and the join happens here, because opening the page
			// is the lead's one action.
			if (started.kind === "failed") return;
			// An attached start stands this session down: the page answers under the seat that serves
			// it, so this session's own seat is not one to keep. The seat is left before `serve` is
			// told nothing, so the door reads the seat it had rather than a page already gone.
			const stoodDown = started.kind !== "served" && deps.lead !== undefined ? await deps.lead.exit(ctx) : false;
			session.serve(started.kind === "served" ? started.seat : undefined);
			// The join is `lib/workflow/join.ts`'s one rule, loaded here so a session that never opens the
			// page pays nothing for it: it asks when the bus does not hold this session under the seat's
			// name, and repeats a disarmed watch as the disarmed join the user asked for.
			const { joinTeam } = await import("../../lib/workflow/join.ts");
			const joined = await joinTeam(session, team, ctx, (await session.who(ctx, ctx.cwd)).label);
			// The address is on the line because the browser is not the only way in: a machine
			// with no default browser prints it here, and a tab closed by mistake is one
			// command from being opened again.
			ctx.ui.notify(
				started.kind === "attached"
					? `board: ${started.seat} is serving this repository on :${started.port} — viewing · open ${started.url}${teamLine(joined)}${stoodDown ? " · lead mode off" : ""}`
					: `board: ${started.seat} serving ${started.repo} on :${started.port} · open ${started.url}${teamLine(joined)}`,
				"info",
			);
			// Serving the page is the seat: the page answers under this session's name, so
			// the pane takes the mode the name already implies. An `attached` start stands
			// the session down — someone else's page is serving — and leaves the seat it held.
			if (started.kind === "served" && deps.lead !== undefined) {
				await deps.lead.enter(ctx);
				ctx.ui.notify("lead mode on: sign and dispatch; /board stop to write.", "info");
			}
		},
	});
}

/** The words, as the warning that names them: a sign takes a card, and nothing else does. */
function wordHelp(): string {
	return BOARD_WORDS.map((entry) => (signOf(entry) === undefined ? `/board ${entry}` : `/board ${entry} <id>`)).join(
		", ",
	);
}

/** A line for the person, and the tone it is shown in: a failure is not the same news as a sign. */
interface SignLine {
	text: string;
	tone: "info" | "warning" | "error";
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
async function signLine(
	pi: ExtensionAPI,
	session: BoardSession,
	sign: Sign,
	words: readonly string[],
	ctx: ExtensionCommandContext,
	notify: Deliver | undefined,
	verify?: VerifyRun,
): Promise<SignLine> {
	const { id: rawCard, override, root, rootError } = signWords(words);
	/**
	 * The run a spot-check records, or the sentence that stops it.
	 *
	 * The read, the run and the words are `lib/workflow/verify.ts`'s: the tool's door asks the card the
	 * same question, and a person signing at a keyboard must get the same answer for the same card.
	 */
	const verifiedFor = async (
		store: BoardStore,
		cardId: string,
		override: string | undefined,
		root: string | undefined,
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
			run: verify ?? module.defaultVerifyRun(),
			now: () => session.now(),
			tree: module.treeOf(pi),
		});
	};
	if (rootError !== undefined) return { text: `board: ${rootError}`, tone: "info" };
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	if (id === undefined) return { text: `board: ${sign} needs a card id — try /board ${sign} 4`, tone: "info" };
	// Two signs, one flag: an approval is a contract read, and nothing about a close belongs on it.
	if (override !== undefined && sign === "approve") {
		return { text: "board: approve takes no --override — a contract is approved while it is in plan", tone: "info" };
	}
	if (root !== undefined && sign === "approve") {
		return { text: "board: approve takes no --root — a contract is approved in plan", tone: "info" };
	}
	// The store is a repository read and a file write, and a command has nowhere else to report
	// what they throw: without this the person sees a raw command error instead of a line.
	let result: MutateResult;
	let store: BoardStore;
	let lead: string;
	let actor: Actor;
	try {
		store = await session.store(ctx.cwd);
		lead = store.config().lead;
		// The gate before anything it gates: a sign typed where the lead is not costs no plan read and
		// starts no process. The session that serves the page is the lead, so the label read here is the
		// one a person writes under after `/board`.
		const who = await session.who(ctx, ctx.cwd);
		const refused = leadDoor(sign, who, lead);
		if (refused !== undefined) return { text: `board: ${refused}`, tone: "warning" };
		// A board that names no lead has nobody to write as, so the person's sign is the one door it has.
		actor = lead === "" ? personActor() : who;
		// An approval covers the plan the card names as well as its wording, so it is proved before
		// the write — the same proof the tool hands in, from the one module that reads it. A
		// spot-check needs none: the `done` move proves the plan then.
		const proof = sign === "approve" ? await import("./proof.ts") : undefined;
		const artifact = proof === undefined ? undefined : await proof.provedPlan(session, ctx.cwd, store, id);
		// The run rides the sign here too: this door is the person's, so it executes the command the
		// contract names exactly as the tool's does, through the one body both doors share.
		const evidence = sign === "review" ? await verifiedFor(store, id, override, root, actor) : undefined;
		if (evidence !== undefined && "error" in evidence) return { text: `board: ${evidence.error}`, tone: "info" };
		result = await store.mutate(id, signOp(sign, override, artifact, evidence?.verified), actor, session.now());
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
		deliver: notify ?? createDeliver(pi),
		at: session.now(),
		audience: { roster: () => session.roster(ctx.cwd), now: () => session.now() },
	});
	const clause = settled.line?.trim();
	return { text: clause === undefined ? text : `${text} · ${clause}`, tone: "info" };
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

/** The flag that turns a `review` into the close a gate was not asked for. */
const OVERRIDE_FLAG = "--override";

/** The flag that names the tree a `review` runs in. */
const ROOT_FLAG = "--root";

/**
 * A sign's words: the card it names, the tree a review runs in, and the reason the rest of the line
 * gives.
 *
 * `review 4 --root /path/to/card --override closed on my instruction` — the reason is everything
 * after the override flag, unquoted, so a sentence with spaces in it is one argument rather than a
 * quoting rule nobody remembers. `--root` must come before `--override` for the same reason: the
 * override owns the rest of the line. A flag with nothing after it is refused rather than silently
 * falling back to the session's tree.
 */
function signWords(words: readonly string[]): {
	id: string | undefined;
	override: string | undefined;
	root: string | undefined;
	rootError: string | undefined;
} {
	const lower = (word: string): string => word.toLowerCase();
	const overrideAt = words.findIndex((word) => lower(word) === OVERRIDE_FLAG);
	const beforeOverride = overrideAt === -1 ? words : words.slice(0, overrideAt);
	const rootAt = beforeOverride.findIndex((word) => lower(word) === ROOT_FLAG);
	const root = rootAt === -1 ? undefined : beforeOverride[rootAt + 1];
	const named = rootAt === -1 ? beforeOverride : beforeOverride.slice(0, rootAt);
	return {
		id: named[0] === undefined ? undefined : named[0].toLowerCase(),
		override: overrideAt === -1 ? undefined : words.slice(overrideAt + 1).join(" "),
		root,
		rootError: rootAt !== -1 && root === undefined ? "review --root needs a tree" : undefined,
	};
}

/** One line for `/board status`: the page this session serves, watches, or does not have. */
export function statusLine(status: BoardPageStatus, team?: TeamState): string {
	if (status.running) {
		const watching = plural(status.watchers ?? 0, "tab");
		return `board: ${status.seat} serving ${status.repo} on :${status.port} · ${watching} watching · ${status.where}${teamLine(team)}`;
	}
	if (status.stale === true) {
		return `board: watching ${status.seat} on :${status.port} — that note answers nobody; /board stop drops it${teamLine(team)}`;
	}
	if (status.attached === true) {
		return `board: watching ${status.seat} on :${status.port} — nothing to stop here${teamLine(team)}`;
	}
	// The team outlives the page: a session that claimed a card is on it with no page open, so
	// the line says which team this session is on whichever door put it there.
	return `board: not running — /board opens it${teamLine(team)}`;
}

/**
 * What `/board stop` says after it went to drop a note nobody answers.
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

/**
 * What a boundary has to answer: the cards this session still holds, the word typed past `next`, or a
 * read that failed. One of the three, because nothing else is a reason to refuse a new session.
 */
export type NextAsk = { argued: string } | { unreadable: true } | { held: readonly Card[] };

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
	if ("argued" in ask) {
		return "board: /board next takes no card — the session it starts finds yours on its first turn";
	}
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
