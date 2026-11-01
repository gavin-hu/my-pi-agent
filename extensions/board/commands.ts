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
import { cardRef, normalizeCardId } from "../../lib/board/card.ts";
import { notToldLine, PERSON_LABEL, personActor, type Sign, signOf } from "../../lib/board/lead.ts";
import { plural } from "../../lib/board/round-text.ts";
import { type BoardSession } from "../../lib/board/session.ts";
import type { MutateResult } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import type { JoinResult } from "../../lib/session-tool.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { teamLine } from "./join.ts";
import type { BoardPage, BoardPageStatus } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** The words the command accepts, in the order a user is likely to want them. */
const BOARD_WORDS = ["archive", "approve", "review", "status", "stop", "team"] as const;

export function registerCommands(
	pi: ExtensionAPI,
	session: BoardSession,
	page: BoardPage,
	deps: { team?: TeamJoin } = {},
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
				const line = await signLine(session, sign, rest, ctx);
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
				ctx.ui.notify(statusLine(await page.status(), session.team.last()), "info");
				return;
			}
			if (word === "stop") {
				const status = await page.status();
				// A note nobody answers is not a page to leave for the next session to trip over:
				// it is dropped here, and the line says whose it was.
				if (status.stale === true) {
					const dropped = await page.dropStale(ctx);
					ctx.ui.notify(
						dropped
							? `board: dropped ${status.seat}'s note for :${status.port} — it answered nobody`
							: `board: nothing to stop here — ${status.seat} is answering on :${status.port}`,
						"info",
					);
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
			const joined = await team.join(ctx, { label: (await session.who(ctx, ctx.cwd)).label });
			session.team.record(joined);
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
 * Why a sign from the command reaches nobody, in the words the line carries.
 *
 * The tool tells the owner through a nested `session send`; a command context has no
 * `ctx.executeTool`, so this door writes the sign and the owner reads it on its next `list`.
 */
const NO_PEER = "a command cannot reach a peer — it reads the sign on its next list";

/**
 * Sign one of the card's two gates as the person at the keyboard.
 *
 * The write is the same `mutate` the tool uses, so the rules are the state machine's: an
 * `approve` outside `plan`, a `review` outside `execute`, an unknown id, and a card already
 * signed are each refused with the sentence the tool would give. The one thing that differs
 * is the actor — the person, whose id no session can have — which is what makes the sign a
 * sign even when the session that typed it holds the card.
 */
async function signLine(
	session: BoardSession,
	sign: Sign,
	words: readonly string[],
	ctx: ExtensionCommandContext,
): Promise<SignLine> {
	const { id: rawCard, override } = signWords(words);
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	if (id === undefined) return { text: `board: ${sign} needs a card id — try /board ${sign} 4`, tone: "info" };
	// Two signs, one flag: an approval is a contract read, and nothing about a close belongs on it.
	if (override !== undefined && sign === "approve") {
		return { text: "board: approve takes no --override — a contract is approved while it is in plan", tone: "info" };
	}
	// The store is a repository read and a file write, and a command has nowhere else to report
	// what they throw: without this the person sees a raw command error instead of a line.
	let result: MutateResult;
	try {
		const store = await session.store(ctx.cwd);
		result = await store.mutate(
			id,
			override === undefined ? { kind: sign } : { kind: "review", override },
			personActor(),
			session.now(),
		);
	} catch (error) {
		return { text: `board: ${sign} ${cardRef(id)} failed — ${messageOf(error)}`, tone: "error" };
	}
	if (!result.ok) return { text: `board: ${result.error}`, tone: "info" };
	const done = sign === "approve" ? "approved" : "reviewed";
	const how = result.card.review?.byInstruction === undefined ? "" : " · closed by instruction";
	const text = result.changed
		? `board: ${cardRef(id)} ${done} by ${PERSON_LABEL}${how}`
		: `board: ${cardRef(id)} is already ${done} by ${PERSON_LABEL}${how}`;
	if (result.card.owner === undefined) return { text, tone: "info" };
	// A command context has no nested `session send`, so a sign from here reaches nobody. Saying
	// so is the only moment that trade-off costs something; the signature is recorded either way.
	return { text: `${text} · ${notToldLine(result.card.owner.label, NO_PEER)}`, tone: "info" };
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
export function statusLine(status: BoardPageStatus, team?: JoinResult): string {
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
