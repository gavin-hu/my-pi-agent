/**
 * `/board` — the page's one entry point, and the person's door to the two signs.
 *
 * `team` opens the page on the Team tab, `status` prints one line, `stop` closes it, and
 * `approve <id>` / `review <id>` write the two signs a session that holds the card may not
 * give. Everything else opens the page. The command is a thin parser — the lifecycle is
 * `page.ts`'s, the transitions are `lib/board/steps.ts`'s — so the idle grace and
 * `session_shutdown` close the same server this opens.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { cardRef, normalizeCardId } from "../../lib/board/card.ts";
import { plural } from "../../lib/board/round-text.ts";
import { type BoardSession, PERSON_LABEL, personActor } from "../../lib/board/session.ts";
import type { JoinResult } from "../../lib/session-tool.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { teamLine } from "./join.ts";
import type { BoardPage, BoardPageStatus } from "./page.ts";

/** The command's name, which is also the word a user types. */
export const BOARD_COMMAND = "board";

/** The words the command accepts, in the order a user is likely to want them. */
const BOARD_WORDS = ["approve", "review", "status", "stop", "team"] as const;

/** The two signs a person gives, and where each is written. */
const SIGN_WORDS = ["approve", "review"] as const;

/** One of the signs, or undefined when the word is not one. */
function signOf(word: string): (typeof SIGN_WORDS)[number] | undefined {
	return SIGN_WORDS.find((sign) => sign === word);
}

export function registerCommands(
	pi: ExtensionAPI,
	session: BoardSession,
	page: BoardPage,
	deps: { team?: TeamJoin } = {},
): void {
	const team = deps.team ?? createTeamJoin(pi);
	pi.registerCommand(BOARD_COMMAND, {
		description:
			"Open the shared board in a local browser, or sign its two gates: /board [team | status | stop | approve <id> | review <id>]",
		getArgumentCompletions: (prefix: string) => {
			const text = prefix.trimStart();
			if (text.includes(" ")) return null;
			const items = BOARD_WORDS.filter((word) => word.startsWith(text));
			return items.length > 0 ? items.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [word = "", rawCard] = args.trim().toLowerCase().split(/\s+/);
			const sign = signOf(word);
			if (sign !== undefined) {
				ctx.ui.notify(await signLine(session, sign, rawCard, ctx), "info");
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
			const joined = await team.join(ctx, { label: session.who(ctx, ctx.cwd).label });
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

/** The words, as the warning that names them. */
function wordHelp(): string {
	return BOARD_WORDS.map((entry) =>
		/^(approve|review)$/.test(entry) ? `/board ${entry} <id>` : `/board ${entry}`,
	).join(", ");
}

/**
 * Sign one of the card's two gates as the person at the keyboard.
 *
 * The write is the same `mutate` the tool uses, so the rules are the state machine's: an
 * `approve` outside `plan`, a `review` outside `execute`, an unknown id, and a card already
 * signed are each refused with the sentence the tool would give. The one thing that differs
 * is the actor — a label with no session id — which is what makes the sign allowed.
 */
async function signLine(
	session: BoardSession,
	sign: (typeof SIGN_WORDS)[number],
	rawCard: string | undefined,
	ctx: ExtensionCommandContext,
): Promise<string> {
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	if (id === undefined) {
		return `board: ${sign} needs a card id — try /board ${sign} 4`;
	}
	const store = await session.store(ctx.cwd);
	const result = await store.mutate(id, { kind: sign }, personActor(), session.now());
	if (!result.ok) return `board: ${result.error}`;
	const done = sign === "approve" ? "approved" : "reviewed";
	return result.changed
		? `board: ${cardRef(id)} ${done} by ${PERSON_LABEL}`
		: `board: ${cardRef(id)} is already ${done} by ${PERSON_LABEL}`;
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
