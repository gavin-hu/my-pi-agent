/**
 * `/board` — the page's one entry point, and the person's door to the two signs.
 *
 * `team` opens the page on the Team tab, `status` prints one line, `stop` closes it, and
 * `approve <id>` / `review <id>` write the two signs as the person at the keyboard, which is what
 * a session that is not the board's lead cannot do. Everything else opens the page. The command
 * is a thin parser — the lifecycle is `page.ts`'s, the transitions are `lib/board/steps.ts`'s —
 * so the idle grace and `session_shutdown` close the same server this opens.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ArtifactProof } from "../../lib/board/artifact.ts";
import { cardRef, normalizeCardId } from "../../lib/board/card.ts";
import { PERSON_LABEL, personActor, type Sign, signMark, signOf } from "../../lib/board/lead.ts";
import type { Verification } from "../../lib/board/contract.ts";
import type { CardOp } from "../../lib/board/rules.ts";
import { plural } from "../../lib/board/round-text.ts";
import { type BoardSession } from "../../lib/board/session.ts";
import type { BoardStore, MutateResult } from "../../lib/board/store.ts";
import type { VerifyRun } from "../../lib/board/verify.ts";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { messageOf } from "../../lib/errors.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import type { Notify } from "./announce.ts";
import { type TeamState, teamLine } from "./join.ts";
import type { BoardPage, BoardPageStatus, StaleDrop } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** The words the command accepts, in the order a user is likely to want them. */
const BOARD_WORDS = ["archive", "approve", "review", "status", "stop", "team"] as const;

export function registerCommands(
	pi: ExtensionAPI,
	session: BoardSession,
	page: BoardPage,
	deps: { team?: TeamJoin; notify?: Notify; verify?: VerifyRun } = {},
): void {
	const team = deps.team ?? createTeamJoin(pi);
	pi.registerCommand(BOARD_COMMAND, {
		description:
			"Open the shared board in a local browser, sign its two gates as the person, or fold the finished cards away: /board [archive | team | status | stop | approve <id> | review <id> [--override <why>]]",
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
				// The person's door to the sweep the tool already had: one rule for both, so the
				// count the rollup prints and the cards this moves cannot be two sets.
				const { sweepFinished, sweepText } = await import("./archive.ts");
				const store = await session.store(ctx.cwd);
				const swept = await sweepFinished(store, personActor(), session.now());
				ctx.ui.notify(`board: ${sweepText(swept)}`, swept.failed.length > 0 ? "warning" : "info");
				return;
			}
			if (word === "status") {
				// The bus's record answers first: a disarm through `/session join` never reaches this
				// session, so the remembered standing is only the answer when the bus cannot give one.
				const { teamStatus } = await import("../../lib/board/join.ts");
				ctx.ui.notify(statusLine(await page.status(), await teamStatus(session, ctx)), "info");
				return;
			}
			if (word === "stop") {
				const status = await page.status();
				// A note nobody answers is not a page to leave for the next session to trip over:
				// it is dropped here, and the line says whose it was.
				if (status.stale === true) {
					const dropped = await page.dropStale(ctx);
					ctx.ui.notify(dropLine(dropped, status), "info");
					return;
				}
				// A page another session serves is that session's to stop, and saying whose it is is the answer.
				if (status.attached === true) {
					ctx.ui.notify(
						`board: nothing to stop here — ${status.seat} serves this repository on :${status.port}`,
						"info",
					);
					return;
				}
				const stopped = await page.stop();
				// The word is this session saying it serves nothing now: the page clears the seat too
				// when it closes itself (the idle grace), and both writes are the same fact.
				session.serve(undefined);
				ctx.ui.notify(stopped ? "board: stopped" : "board: not running", "info");
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
			session.serve(started.kind === "served" ? started.seat : undefined);
			// The join is `lib/board/join.ts`'s one rule, loaded here so a session that never opens the
			// page pays nothing for it: it asks when the bus does not hold this session under the seat's
			// name, and repeats a disarmed watch as the disarmed join the user asked for.
			const { joinTeam } = await import("../../lib/board/join.ts");
			const joined = await joinTeam(session, team, ctx, (await session.who(ctx, ctx.cwd)).label);
			// The address is on the line because the browser is not the only way in: a machine
			// with no default browser prints it here, and a tab closed by mistake is one
			// command from being opened again.
			ctx.ui.notify(
				started.kind === "attached"
					? `board: ${started.seat} is serving this repository on :${started.port} — viewing · open ${started.url}${teamLine(joined)}`
					: `board: ${started.seat} serving ${started.repo} on :${started.port} · open ${started.url}${teamLine(joined)}`,
				"info",
			);
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
	tone: "info" | "error";
}

/**
 * Sign one of the card's two gates as the person at the keyboard.
 *
 * The write is the same `mutate` the tool uses, so the rules are the state machine's: an
 * `approve` outside `plan`, a `review` outside `execute`, an unknown id, and a card already
 * signed are each refused with the sentence the tool would give. The one thing that differs
 * is the actor — the person, whose id no session can have — which is what makes the sign a
 * sign even when the session that typed it holds the card. The message that follows is the
 * tool's too: a command cannot call a tool, so `announce` sends by the request the bus answers.
 */
async function signLine(
	pi: ExtensionAPI,
	session: BoardSession,
	sign: Sign,
	words: readonly string[],
	ctx: ExtensionCommandContext,
	notify: Notify | undefined,
	verify?: VerifyRun,
): Promise<SignLine> {
	const { id: rawCard, override } = signWords(words);
	/**
	 * The run a spot-check records, or the sentence that stops it.
	 *
	 * The read, the run and the words are `lib/board/verify.ts`'s: the tool's door asks the card the
	 * same question, and a person signing at a keyboard must get the same answer for the same card.
	 */
	const verifiedFor = async (
		store: BoardStore,
		cardId: string,
		override: string | undefined,
	): Promise<{ verified: Verification } | { error: string } | undefined> => {
		const card = await store.read(cardId).catch(() => undefined);
		if (card === undefined) return undefined;
		const module = await import("../../lib/board/verify.ts");
		// The gate, the override and the run are `lib/board/verify.ts`'s, as the tool's door asks them:
		// a sign that would be refused starts no process, and the refusal stays the store's to give.
		return module.spotCheck({
			card,
			actor: personActor(),
			lead: store.config().lead,
			override,
			// The tree this session is working in, as the tool's door reads it: the worktree it entered when
			// there is one, and `ctx.cwd` otherwise, which never follows `worktree enter` by itself.
			cwd: resolveEffectiveCwd(ctx.cwd),
			run: verify ?? module.defaultVerifyRun(),
			now: () => session.now(),
			sha: module.shaOf(pi),
		});
	};
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	if (id === undefined) return { text: `board: ${sign} needs a card id — try /board ${sign} 4`, tone: "info" };
	// Two signs, one flag: an approval is a contract read, and nothing about a close belongs on it.
	if (override !== undefined && sign === "approve") {
		return { text: "board: approve takes no --override — a contract is approved while it is in plan", tone: "info" };
	}
	// The store is a repository read and a file write, and a command has nowhere else to report
	// what they throw: without this the person sees a raw command error instead of a line.
	let result: MutateResult;
	let lead: string;
	try {
		const store = await session.store(ctx.cwd);
		lead = store.config().lead;
		// An approval covers the plan the card names as well as its wording, so it is proved before
		// the write — the same proof the tool hands in, from the one module that reads it. A
		// spot-check needs none: the `done` move proves the plan then.
		const proof = sign === "approve" ? await import("./proof.ts") : undefined;
		const artifact = proof === undefined ? undefined : await proof.provedPlan(session, ctx.cwd, store, id);
		// The run rides the sign here too: this door is the person's, so it executes the command the
		// contract names exactly as the tool's does, through the one body both doors share.
		const evidence = sign === "review" ? await verifiedFor(store, id, override) : undefined;
		if (evidence !== undefined && "error" in evidence) return { text: `board: ${evidence.error}`, tone: "info" };
		result = await store.mutate(id, signOp(sign, override, artifact, evidence?.verified), personActor(), session.now());
	} catch (error) {
		return { text: `board: ${sign} ${cardRef(id)} failed — ${messageOf(error)}`, tone: "error" };
	}
	if (!result.ok) return { text: `board: ${result.error}`, tone: "info" };
	const done = sign === "approve" ? "approved" : "reviewed";
	// The close is a review's fact and never an approval's, so the word decides whether the card is
	// asked at all: a card in plan that carries a review — a hand-edited file, since no path writes
	// one — must not put its reason on the line an approval prints.
	const how = sign === "review" && result.card.review?.byInstruction !== undefined ? " · closed by instruction" : "";
	// What ran is the one fact a person at a keyboard cannot see in the card: the sign's own words.
	const ran = result.card.review?.verified;
	const where = ran?.root === undefined ? "" : ` in ${ran.root}`;
	const evidence = ran === undefined ? "" : ` · ran \`${ran.cmd}\`${where} (exit ${ran.exit})`;
	const text = result.changed
		? `board: ${cardRef(id)} ${done} by ${PERSON_LABEL}${how}${evidence}`
		: `board: ${cardRef(id)} is already ${done} by ${PERSON_LABEL}${how}${evidence}`;
	// The message is the tool's rule as well as its transport — `announce` on the result is what a
	// fresh stamp and an untold repeat both set, so this door re-sends a sign the owner never heard
	// exactly as the tool does. The sign's own signer may record it, which is why `personActor` is
	// the actor: `announced` compares with `signedAs`, and the person's mark is on the sign.
	if (result.announce !== true) return { text, tone: "info" };
	const { settleSign, notifyOverBus } = await import("./announce.ts");
	// The message and the record are one body, shared with the tool's door; this door supplies the
	// person as the actor, since `announced` compares with the mark that sign carries.
	const settled = await settleSign({
		store: () => session.store(ctx.cwd),
		card: result.card,
		sign,
		by: signMark(personActor(), lead).by,
		actor: personActor(),
		ctx,
		notify: notify ?? notifyOverBus(pi),
		at: session.now(),
		audience: { roster: () => session.roster(ctx.cwd), now: () => session.now() },
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

/** The flag that turns a `review` into the close a gate was not asked for. */
const OVERRIDE_FLAG = "--override";

/**
 * A sign's words: the card it names, and the reason the rest of the line gives.
 *
 * `review 4 --override closed on my instruction` — the reason is everything after the flag,
 * unquoted, so a sentence with spaces in it is one argument rather than a quoting rule
 * nobody remembers. A flag with nothing after it arrives as the empty string rather than as
 * no flag at all, so the refusal is the state machine's "needs the one line saying why".
 */
function signWords(words: readonly string[]): { id: string | undefined; override: string | undefined } {
	const at = words.findIndex((word) => word.toLowerCase() === OVERRIDE_FLAG);
	const named = at === -1 ? words : words.slice(0, at);
	return {
		id: named[0] === undefined ? undefined : named[0].toLowerCase(),
		override: at === -1 ? undefined : words.slice(at + 1).join(" "),
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
