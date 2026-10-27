/**
 * The `board` tool: the shared feature list for one repository.
 *
 * One action-shaped tool, because every action is work on the same record and a
 * model that has read the board should not have to learn a second surface to change
 * it. The tool owns nothing but the dispatch: the workspace comes from
 * `lib/board/session.ts`, the transition from `lib/board/rules.ts`, the bytes from
 * `lib/board/store.ts`, and the words from `format.ts` and `result.ts`.
 *
 * A refusal is a failed result that still carries the card, so the next call starts
 * from the truth — and it is the same refusal the page shows, because both go
 * through `applyOp`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { type Card, cardRef, matchesQuery, normalizeCardId } from "../../lib/board/card.ts";
import { indexOf } from "../../lib/board/links.ts";
import { type CardOp, holds } from "../../lib/board/rules.ts";
import { buildRound } from "../../lib/board/round.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import { revParse } from "../../lib/git/read.ts";
import { strayField } from "../../lib/stray-fields.ts";
import { createExecRunner } from "../../lib/git/runner.ts";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, detailsOrLine, isTailResult, TailResult } from "../../lib/tui/tool.ts";
import { formatRound } from "../../lib/board/round-text.ts";
import {
	archiveNote,
	formatArchive,
	formatArchived,
	formatBoard,
	formatCard,
	formatDropped,
	formatSkipped,
} from "./format.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { collapsedLine, resultInput } from "./result.ts";
import { createInput } from "./input.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { BoardParams } from "./schema.ts";
import {
	ACTION_FIELDS,
	BOARD_ACTION_DOCS,
	BOARD_ACTIONS,
	BOARD_MUTATING_ACTIONS,
	BOARD_TOOL,
	type BoardAction,
	type BoardDetails,
	normalizeBoardAction,
} from "./types.ts";

/** The verbs as one sentence, in `BOARD_ACTIONS` order; the table owns the words. */
function verbHelp(): string {
	return `${BOARD_ACTIONS.map((action) => `\`${action}\` ${BOARD_ACTION_DOCS[action]}`).join("; ")}.`;
}

/** The parameters as the schema validates them. */
type BoardArgs = Static<typeof BoardParams>;

/**
 * The call line's subject: the verb and what it acts on.
 *
 * `add` shows the title because the title is the identity of the thing being
 * created; every other action names the card it touches, which is what a reader
 * scanning the transcript is looking for.
 */
function callSubject(action: BoardAction, args: Record<string, unknown>): string {
	const card = typeof args.card === "string" && args.card.trim() !== "" ? cardRef(args.card.trim()) : "";
	if (action === "add") {
		const title = typeof args.title === "string" ? args.title.trim() : "";
		return title === "" ? "add" : `add ${title}`;
	}
	if (action === "list") {
		const parts = ["list"];
		if (args.round === true) parts.push("round");
		if (typeof args.status === "string") parts.push(args.status);
		if (typeof args.query === "string" && args.query.trim() !== "") parts.push(`"${args.query.trim()}"`);
		if (card !== "") parts.push(card);
		return parts.join(" ");
	}
	if (card === "") return action;
	const status = typeof args.status === "string" ? ` ${args.status}` : "";
	return `${action} ${card}${status}`;
}

/** One refusal: the reason for the model, the state for the renderer. */
function refusal(action: BoardAction, me: BoardDetails["me"], message: string, card?: BoardDetails["card"]) {
	return failedResult(`Error: ${message}`, {
		action,
		me,
		error: message,
		...(card === undefined ? {} : { card }),
	});
}

/**
 * The commit at `cwd`'s `HEAD`, shortened, or nothing when there is none.
 *
 * A finished card records what closed it, and the commit is the one fact a repository can
 * answer that the card cannot. A directory that is not a repository, or one with no
 * commits, answers nothing — the move still happens, because finishing a card must not
 * depend on git.
 */
async function headCommit(pi: ExtensionAPI, cwd: string): Promise<{ commit: string } | undefined> {
	const id = await revParse(createExecRunner(pi), cwd, "HEAD");
	return id === undefined ? undefined : { commit: id.slice(0, 7) };
}

export function registerTools(pi: ExtensionAPI, runtime: BoardSession, deps: { team?: TeamJoin } = {}): void {
	const team = deps.team ?? createTeamJoin(pi);
	pi.registerTool({
		name: BOARD_TOOL,
		label: "Board",
		description:
			"The shared feature list for this repository: one card per feature, which any session reads and writes. " +
			"A card carries the feature's outcome, the session that holds it, path hints, the plan it is executing, " +
			`its priority, what it waits for, and its notes. ${verbHelp()} A card's steps do not belong on the ` +
			"board - they belong in the plan and in `todo`.",
		promptSnippet: `The shared feature list for this repository: ${BOARD_ACTIONS.join(", ")}.`,
		promptGuidelines: [
			"Claim a card before working on it; release or finish it when you stop, and reclaim a card whose owner is gone.",
			"Record the plan file with `board` action `plan` once the plan is approved, then execute it.",
			"Note each phase of the work, and move the card to `done` or `blocked` when it changes state.",
			"A card that waits on another is linked with `edit` and `dependsOn`, so the order is on the board instead of in a refusal.",
			"A feature's steps belong in `todo`, not on the board: one card is one feature, whatever it takes.",
			"A `handoff` in your inbox is work you now own: read it with `session inbox`, record the plan, and start it.",
			"`paths` are hints for a reader, not claims; `session`'s path claims are what protect a file.",
		],
		parameters: BoardParams,
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const args = params as BoardArgs;
			const action = normalizeBoardAction(args.action);
			if (!action) {
				return refusal(
					"list",
					{ label: "board" },
					`unknown action "${String(args.action)}"; use ${BOARD_ACTIONS.join(", ")}.`,
				);
			}
			const me = runtime.who(ctx, ctx.cwd);
			try {
				// Before the join and the store: a refused call has done nothing, so it cannot
				// have enlisted this session as a teammate on its way to the refusal.
				const stray = strayField(action, args, ACTION_FIELDS);
				if (stray !== undefined) return refusal(action, me, stray);
				// Working a card makes this session a teammate, once: the board is the user's
				// surface for the team, so nobody has to know the bus exists. A failed join is
				// not a failed card write — the board works with no bus at all — and it is not
				// marked, so the next write asks again.
				if (BOARD_MUTATING_ACTIONS.has(action) && !runtime.joined()) {
					if ((await team.join(ctx)).ok) runtime.markJoined();
				}
				const store = await runtime.store(ctx.cwd);
				const now = runtime.now();
				switch (action) {
					case "list":
						return await read(store, action, me, args, now);
					case "add":
						return await add(store, me, args, now);
					case "claim":
						return await mutate(store, action, me, now, args, { kind: "claim" });
					case "release":
						return await mutate(store, action, me, now, args, { kind: "release" });
					case "reclaim":
						return await mutate(store, action, me, now, args, { kind: "reclaim" });
					case "move": {
						if (args.card === undefined) return refusal(action, me, 'card is required: pass the id, e.g. "4".');
						const status = args.status;
						if (status === undefined || status === "todo") {
							return refusal(
								action,
								me,
								'move needs a target lane: "doing", "blocked", or "done". Use release to return a card to todo.',
							);
						}
						// Only the lane that has something to say reads for it: a move to `done`
						// records the commit that closed the card, and a board outside a
						// repository simply has none to record.
						const landed = status === "done" ? await headCommit(pi, ctx.cwd) : undefined;
						return await mutate(store, action, me, now, args, {
							kind: "move",
							status,
							...(args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy }),
							...(landed === undefined ? {} : { landed }),
						});
					}
					case "note":
						return await mutate(store, action, me, now, args, { kind: "note", text: args.text });
					case "plan":
						return await mutate(store, action, me, now, args, { kind: "plan", path: args.path });
					case "edit": {
						if (
							args.title === undefined &&
							args.paths === undefined &&
							args.priority === undefined &&
							args.dependsOn === undefined
						) {
							return refusal(action, me, "edit needs a title, paths, priority, or dependsOn.");
						}
						return await mutate(store, action, me, now, args, {
							kind: "edit",
							title: args.title,
							paths: args.paths,
							priority: args.priority,
							dependsOn: args.dependsOn,
						});
					}
					case "drop":
						return await dropCard(store, me, args, now);
					case "archive":
						return await archiveCards(store, me, args, now);
				}
			} catch (error) {
				return refusal(action, me, messageOf(error));
			}
		},

		renderCall(args, theme, context) {
			const action = normalizeBoardAction(args.action) ?? "list";
			return callLine(theme, context.lastComponent, BOARD_TOOL, callSubject(action, args as Record<string, unknown>));
		},

		renderResult(result, options, theme, context) {
			const text = reuseText(context?.lastComponent);
			const details = toolDetails<BoardDetails>(result.details);
			const outcome = detailsOrLine(theme, result, options.expanded, details);
			if ("line" in outcome) {
				text.setText(outcome.line);
				return text;
			}
			const input = resultInput(outcome.details);
			if (!input) {
				text.setText(collapsedLine(theme, outcome.details));
				return text;
			}
			const previous = context?.lastComponent;
			const view = isTailResult<Card>(previous) ? previous : new TailResult<Card>(input, theme);
			view.setInput(input, theme);
			return view;
		},
	});
}

/** `list`: the board, one card, the lead's rollup, or the archive. */
async function read(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.archived === true) return readArchive(store, action, me, args, now);
	const cards = await store.list();
	// Read once: a card file the reader refused is the difference between "not there"
	// and "there, and this build cannot read it".
	const skipped = await store.skipped();
	// A directory listing, not a read: a listing says what it left aside without opening one.
	const archived = await store.archivedCount();
	if (args.card !== undefined) {
		const id = normalizeCardId(args.card);
		if (id === undefined) return refusal(action, me, `"${args.card}" is not a card id.`);
		const card = cards.find((entry) => entry.id === id);
		if (!card) {
			// Gone and set aside are different answers, and one read by id tells them apart.
			if ((await store.read(id)) !== undefined) {
				return refusal(action, me, `${cardRef(id)} is archived; pass archived: true to read it.`);
			}
			const unreadable = skipped.find((entry) => entry.id === id);
			return refusal(
				action,
				me,
				unreadable === undefined
					? `${cardRef(id)} does not exist.`
					: `${cardRef(id)} is there and this build cannot read it (${unreadable.file}: ${unreadable.why}).`,
			);
		}
		return textResult(formatCard(card, indexOf(cards), now), { action, me, card });
	}
	const listed = cards.filter(
		(card) =>
			(args.status === undefined || card.status === args.status) &&
			(args.query === undefined || matchesQuery(card, args.query)) &&
			// The same rule a claim is checked against, so "mine" cannot list a card this
			// session could not release.
			(args.mine !== true || holds(card, me)),
	);
	// A finished card is history rather than work, and nothing prunes it — this
	// repository's own board is mostly finished cards — so a listing that names no lane
	// leaves them out and says how many. A named lane, `card`, and `round` are unchanged;
	// the rollup counts the whole board, which is what makes it a rollup.
	const hiddenDone = args.status === undefined ? listed.filter((card) => card.status === "done").length : 0;
	const shown = hiddenDone === 0 ? listed : listed.filter((card) => card.status !== "done");
	if (args.round !== true) {
		return textResult(formatBoard(shown, { hiddenDone, archived, skipped }), { action, me, cards: shown });
	}
	const round = buildRound(cards, now);
	// One line under the rollup, because a reader who cannot see a card file should know why,
	// and one for the archive, because a rollup that silently left it out would be a board
	// smaller than the one on disk.
	const notes = [formatSkipped(skipped), archiveNote(archived)].filter((line) => line !== "");
	const text = [formatRound(cards, round), ...notes].join("\n");
	return textResult(text, { action, me, cards: listed, round });
}

/**
 * `list archived: true`: the cards set aside, which no board read opens.
 *
 * A lane and a rollup are answers about the board, so asking for the archive with either
 * is refused rather than quietly ignored: the pile is one thing, and every card in it is
 * finished. A query and `mine` narrow it, because both are questions about a card.
 */
async function readArchive(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	const wrong = (["status", "round"] as const).filter((field) => args[field] !== undefined);
	if (wrong.length > 0) {
		return refusal(
			action,
			me,
			`archived does not read ${wrong.join(", ")}: the archive is one pile of finished cards, out of the board.`,
		);
	}
	const pile = await store.archived();
	if (args.card !== undefined) {
		const id = normalizeCardId(args.card);
		if (id === undefined) return refusal(action, me, `"${args.card}" is not a card id.`);
		const card = pile.cards.find((entry) => entry.id === id);
		if (!card) {
			const onBoard = (await store.list()).some((entry) => entry.id === id);
			return refusal(
				action,
				me,
				onBoard ? `${cardRef(id)} is on the board, not in the archive.` : `${cardRef(id)} is not in the archive.`,
			);
		}
		return textResult(formatCard(card, indexOf(pile.cards), now), { action, me, card });
	}
	const shown = pile.cards.filter(
		(card) => (args.query === undefined || matchesQuery(card, args.query)) && (args.mine !== true || holds(card, me)),
	);
	return textResult(formatArchive(shown, pile.skipped), { action, me, cards: shown });
}

/** `add`: the only action that creates a card. */
async function add(
	store: BoardStore,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	const parsed = createInput({ title: args.title, paths: args.paths, priority: args.priority, note: args.note });
	if ("error" in parsed) return refusal("add", me, parsed.error);
	const card = await store.create(parsed.input, me, now);
	return textResult(formatCard(card), { action: "add", me, card });
}

/** The actions that change a card the caller names. */
async function mutate(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	now: number,
	args: BoardArgs,
	op: CardOp,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.card === undefined) return refusal(action, me, 'card is required: pass the id, e.g. "4".');
	const id = normalizeCardId(args.card);
	if (id === undefined) return refusal(action, me, `"${args.card}" is not a card id.`);
	const result = await store.mutate(id, op, me, now);
	if (!result.ok) return refusal(action, me, result.error, result.card);
	return textResult(formatCard(result.card), { action, me, card: result.card });
}

/**
 * `archive`: a finished card leaves the board without being destroyed.
 *
 * One card, or — with no card named — every finished card, because clearing a board is
 * the errand and a lead should not have to run sixty calls to do it. Each move is its own
 * compare-and-set, so a sweep is best-effort: it reports what it actually set aside.
 */
async function archiveCards(
	store: BoardStore,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.card !== undefined) {
		const id = normalizeCardId(args.card);
		if (id === undefined) return refusal("archive", me, `"${args.card}" is not a card id.`);
		const result = await store.mutate(id, { kind: "archive" }, me, now);
		if (!result.ok) return refusal("archive", me, result.error, result.card);
		// Asked twice is one state, not an error: the card is where the caller wanted it.
		if (!result.changed) return textResult(`${cardRef(id)} is already archived.`, { action: "archive", me });
		return textResult(formatArchived([id]), { action: "archive", me, card: result.card, archived: [id] });
	}
	const finished = (await store.list()).filter((card) => card.status === "done");
	const moved: string[] = [];
	const failed: Array<{ card: string; error: string }> = [];
	for (const card of finished) {
		const result = await store.mutate(card.id, { kind: "archive" }, me, now);
		if (result.ok && result.changed) moved.push(card.id);
		// A sweep is best-effort, and a card that changed underneath it is the one thing it
		// cannot report by silence: "every finished card" must not read as fewer, unexplained.
		else if (!result.ok) failed.push({ card: card.id, error: result.error });
	}
	if (moved.length === 0 && failed.length === 0) {
		return textResult("No finished cards to archive.", { action: "archive", me });
	}
	const text = [
		...(moved.length === 0 ? [] : [formatArchived(moved)]),
		...failed.map((entry) => `${cardRef(entry.card)} was not archived (${entry.error})`),
	].join(" · ");
	return textResult(text, {
		action: "archive",
		me,
		...(moved.length === 0 ? {} : { archived: moved }),
		...(failed.length === 0 ? {} : { failed }),
	});
}

/** `drop`: the card and its notes leave together, so the report is the id. */
async function dropCard(
	store: BoardStore,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.card === undefined) return refusal("drop", me, 'card is required: pass the id, e.g. "4".');
	const id = normalizeCardId(args.card);
	if (id === undefined) return refusal("drop", me, `"${args.card}" is not a card id.`);
	const result = await store.mutate(id, { kind: "drop" }, me, now);
	if (!result.ok) return refusal("drop", me, result.error, result.card);
	return textResult(formatDropped(id), { action: "drop", me, dropped: id });
}
