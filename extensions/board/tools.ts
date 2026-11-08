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
import { type ArtifactCheck, planForContract, planForExecute } from "../../lib/board/artifact.ts";
import { type Card, cardRef, holds, matchesQuery, normalizeCardId } from "../../lib/board/card.ts";
import { movableLanes } from "../../lib/board/lanes.ts";
import { indexOf } from "../../lib/board/links.ts";
import { signMark } from "../../lib/board/lead.ts";
import type { CardOp } from "../../lib/board/rules.ts";
import { buildRound } from "../../lib/board/round.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import type { BoardStore } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import { listOf } from "../../lib/format.ts";
import { strayField } from "../../lib/stray-fields.ts";
import { failedResult, textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, detailsOrLine, isTailResult, TailResult } from "../../lib/tui/tool.ts";
import { formatRound } from "../../lib/board/round-text.ts";
import { CLAIM_NEXT, formatArchive, formatArchived, formatBoard, formatCard, formatDropped } from "./format.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { collapsedLine, resultInput } from "./result.ts";
import type { Notify } from "./announce.ts";
import { createInput } from "./input.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { BoardParams } from "./schema.ts";
import {
	ACTION_FIELDS,
	BOARD_ACTION_DOCS,
	BOARD_ACTIONS,
	BOARD_TOOL,
	type BoardAction,
	type BoardDetails,
	normalizeBoardAction,
} from "./types.ts";

/** The verbs as one sentence, in `BOARD_ACTIONS` order; the table owns the words. */
function verbHelp(): string {
	return `${BOARD_ACTIONS.map((action) => `\`${action}\` ${BOARD_ACTION_DOCS[action]}`).join("; ")}.`;
}

/**
 * The tool's description: what the board is, and the actions it takes.
 *
 * Exported, with {@link BOARD_GUIDELINES}, so the surface budget in
 * `test/prompt-budget.test.ts` measures the text that is really registered instead of a
 * second copy of it. The actions are stated once, in `BOARD_ACTION_DOCS`.
 */
export const BOARD_DESCRIPTION =
	"The shared feature list for this repository: one card per feature, which any session reads and writes. " +
	"A card moves through five lanes - backlog, plan, execute, blocked, done - and carries its outcome, holder, " +
	"contract (goal, acceptance, scopeOut), plan, priority, type, breaking marker, links, and notes. " +
	`${verbHelp()} A card's steps do not belong on the board - they belong in the plan and in \`todo\`.`;

/**
 * The three rules that are not already in the schema, the description, or the action docs.
 *
 * Everything a fourth bullet used to say is stated once by the field or the action it is
 * about — a `blocked` card's resume is the `blocker` parameter's sentence, `dependsOn`'s
 * refusal is its own parameter's, "steps belong in `todo`" closes the description, and
 * "`paths` are hints, not claims" closes the `paths` parameter. Repeating one here costs
 * every request for nothing, which is what the ceiling in `test/prompt-budget.test.ts` is
 * for: one idea per bullet, and none of them already said.
 */
export const BOARD_GUIDELINES = [
	"Claim a card, design it in plan mode, record the contract, then move it to execute: that last gate is the lead's `approve`, or the person's `/board approve`.",
	"Note each phase of the work, and release or reclaim a card you stop holding, so the lane count means what it says.",
	"A `handoff` in your inbox is work you now own: read it with `session inbox`, record the plan, and start it.",
];

/** The one line in the system prompt's tool list: the actions, and nothing they do. */
export const BOARD_SNIPPET = `The shared feature list for this repository: ${BOARD_ACTIONS.join(", ")}.`;

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
		if (typeof args.lane === "string") parts.push(args.lane);
		if (typeof args.query === "string" && args.query.trim() !== "") parts.push(`"${args.query.trim()}"`);
		if (card !== "") parts.push(card);
		return parts.join(" ");
	}
	if (card === "") return action;
	const lane = typeof args.lane === "string" ? ` ${args.lane}` : "";
	return `${action} ${card}${lane}`;
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
 * Whether a result this tool built is a refusal.
 *
 * `refusal` marks one with `isError`, and the success shape (`ToolResult`) has no such
 * field, so this is the one probe that tells the two apart — read here rather than
 * widening the shared envelope with a flag that would then be optional everywhere.
 */
function refused(result: unknown): boolean {
	return typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
}

export function registerTools(
	pi: ExtensionAPI,
	runtime: BoardSession,
	deps: { team?: TeamJoin; notify?: Notify } = {},
): void {
	const team = deps.team ?? createTeamJoin(pi);
	// Loaded at the first sign, not at registration: a board that never signs pays nothing for the
	// message, and the registration graph stays the size it was.
	let signMessage: Promise<typeof import("./announce.ts")> | undefined;
	pi.registerTool({
		name: BOARD_TOOL,
		label: "Board",
		description: BOARD_DESCRIPTION,
		promptSnippet: BOARD_SNIPPET,
		promptGuidelines: BOARD_GUIDELINES,
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
			const me = await runtime.who(ctx, ctx.cwd);
			try {
				// Before the join and before a card is read: a refused call has written nothing, so it
				// cannot have enlisted this session as a teammate on its way to the refusal.
				const stray = strayField(action, args, ACTION_FIELDS);
				if (stray !== undefined) return refusal(action, me, stray);
				const store = await runtime.store(ctx.cwd);
				const now = runtime.now();
				switch (action) {
					case "list":
						// The round folds the owners a bus has no record of, and the rollup is the only read
						// that needs the bus for its own sake: a plain `list` reads no bus file beyond the
						// record that names whoever is calling.
						return await read(store, action, me, args, now, () => runtime.roster(ctx.cwd));
					case "add":
						return await add(store, me, args, now);
					case "claim": {
						const claimed = await mutate(store, action, me, now, args, { kind: "claim" }, { next: CLAIM_NEXT });
						// Taking a card is what makes this session a teammate. It is the one action here
						// worth being addressed about, and the board is the user's surface for the team, so
						// nobody has to know the bus exists. A refused claim wrote nothing and enlists
						// nobody; a refused join is not a failed claim, so the card stands and the next
						// claim asks again — as it does when the bus no longer holds this session.
						if (!refused(claimed)) {
							// Loaded here, not at registration: the join is the claim's side effect, so a
							// session that never claims pays nothing for it.
							const { joinTeam } = await import("../../lib/board/join.ts");
							await joinTeam(runtime, team, ctx, me.label);
						}
						return claimed;
					}
					case "release":
						return await mutate(store, action, me, now, args, { kind: "release" });
					case "reclaim":
						return await mutate(store, action, me, now, args, { kind: "reclaim" });
					case "move": {
						if (args.card === undefined) return refusal(action, me, 'card is required: pass the id, e.g. "4".');
						const lane = args.lane;
						if (lane === undefined) {
							return refusal(action, me, `move needs a target lane: ${listOf(movableLanes())}.`);
						}
						// `execute` and `done` carry the proof that the plan the card recorded is still
						// there, and a board outside a repository simply has no proof to check.
						const proved =
							lane === "execute" || lane === "done"
								? await recordedPlan(runtime, ctx.cwd, store, args.card)
								: undefined;
						return await mutate(store, action, me, now, args, {
							kind: "move",
							lane,
							...(args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy }),
							...(args.blocker === undefined ? {} : { blocker: args.blocker }),
							...(proved === undefined ? {} : { artifact: proved }),
						});
					}
					case "note":
						return await mutate(store, action, me, now, args, { kind: "note", text: args.text });
					case "contract": {
						// The plan is proved here, at the boundary: the state machine decides, but only
						// a caller holding the working directory can answer whether the file is there.
						const plan =
							args.path === undefined ? undefined : planForContract(await runtime.planDir(ctx.cwd), args.path);
						return await mutate(store, action, me, now, args, {
							kind: "contract",
							...(plan === undefined ? {} : { artifact: plan }),
							goal: args.goal,
							acceptance: args.acceptance,
							scopeOut: args.scopeOut,
						});
					}
					case "approve":
					case "review": {
						const { announce, notifyOverBus } = await (signMessage ??= import("./announce.ts"));
						// The name the sign will record, so the owner is told who signed rather than the
						// label the writing actor is called by.
						const signer = signMark(me, store.config().lead).by;
						const told = (card: Card) => announce(card, action, signer, ctx, deps.notify ?? notifyOverBus(pi));
						return await mutate(
							store,
							action,
							me,
							now,
							args,
							action === "review"
								? { kind: "review", text: args.text, override: args.override }
								: { kind: "approve", text: args.text },
							{ told },
						);
					}
					case "edit": {
						if (
							args.title === undefined &&
							args.paths === undefined &&
							args.type === undefined &&
							args.breaking === undefined &&
							args.priority === undefined &&
							args.dependsOn === undefined
						) {
							return refusal(action, me, "edit needs a title, paths, type, breaking, priority, or dependsOn.");
						}
						return await mutate(store, action, me, now, args, {
							kind: "edit",
							title: args.title,
							paths: args.paths,
							type: args.type,
							breaking: args.breaking,
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
			// A `list` is the one action with rows, so a collapsed block is the line that counts
			// them: the rows are what expanding adds, not a second copy of the line's answer.
			const input = options.expanded ? resultInput(outcome.details) : undefined;
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

/**
 * The plan file a card entering `execute` recorded, proved to be there.
 *
 * A `move` names the card, not its plan, so the tool reads the card — one read, on the one
 * lane whose gate needs it — and hands `steps.ts` the fact. A card with no plan recorded
 * gets no fact and the state machine refuses it; a recorded plan that is gone, or outside
 * this repository's store, is refused here with the sentence that names the card and the
 * way out.
 */
async function recordedPlan(
	runtime: BoardSession,
	cwd: string,
	store: BoardStore,
	rawCard: string | undefined,
): Promise<ArtifactCheck | undefined> {
	const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
	const card = id === undefined ? undefined : await store.read(id);
	if (card?.planPath === undefined) return undefined;
	return planForExecute(await runtime.planDir(cwd), card);
}

/** The `list` fields that narrow a listing, in the order a refusal names them. */
const CARD_FILTERS = ["lane", "query", "mine", "round"] as const;

/**
 * The refusal for the filters a `list` that names a card would otherwise drop.
 *
 * `card` answers for that one card, so a filter beside it changes nothing — and a call that
 * sent both meant one of them. A dropped field is what `strayField` exists to prevent one
 * level up, so it is refused here in the same voice the archive's own reader uses.
 */
function cardFiltersRefusal(args: BoardArgs, fields: readonly (keyof BoardArgs)[] = CARD_FILTERS): string | undefined {
	const given = fields.filter((field) => args[field] !== undefined);
	return given.length === 0 ? undefined : `card does not read ${given.join(", ")}: it answers for that one card.`;
}

/** `list`: the board, one card, the lead's rollup, or the archive. */
async function read(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
	roster: () => Promise<readonly RosterSession[] | undefined>,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.archived === true) return readArchive(store, action, me, args, now);
	const cards = await store.list();
	// Read once: a card file the reader refused is the difference between "not there"
	// and "there, and this build cannot read it".
	const skipped = await store.skipped();
	// A directory listing, not a read: a listing says what it left aside without opening one.
	const archived = await store.archivedCount();
	if (args.card !== undefined) {
		const ignored = cardFiltersRefusal(args);
		if (ignored !== undefined) return refusal(action, me, ignored);
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
			(args.lane === undefined || card.lane === args.lane) &&
			(args.query === undefined || matchesQuery(card, args.query)) &&
			// The same rule a claim is checked against, so "mine" cannot list a card this
			// session could not release.
			(args.mine !== true || holds(card, me)),
	);
	// A finished card is history rather than work, and nothing prunes it — this
	// repository's own board is mostly finished cards — so a listing that names no lane
	// leaves them out and says how many. A named lane and `card` are unchanged; the rollup
	// counts the whole board, which is what makes it a rollup.
	const hiddenDone = args.lane === undefined ? listed.filter((card) => card.lane === "done").length : 0;
	const shown = hiddenDone === 0 ? listed : listed.filter((card) => card.lane !== "done");
	// The rollup is the whole board's answer, so it is printed *after* the listing rather than
	// instead of it: a filter beside `round` asked two questions, and a call that answered only
	// one of them dropped the other without saying so.
	const narrowed = args.lane !== undefined || args.query !== undefined || args.mine === true;
	const listing = formatBoard(shown, { hiddenDone, archived, skipped, narrowed });
	const details: BoardDetails = {
		action,
		me,
		cards: shown,
		...(narrowed ? { narrowed } : {}),
		...(args.mine === true ? { mine: true } : {}),
	};
	if (args.round !== true) return textResult(listing, details);
	const round = buildRound(cards, now);
	const text = `${listing}\n\n${formatRound(cards, round, await roster())}`;
	return textResult(text, { ...details, round });
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
	const wrong = (["lane", "round"] as const).filter((field) => args[field] !== undefined);
	if (wrong.length > 0) {
		return refusal(
			action,
			me,
			`archived does not read ${wrong.join(", ")}: the archive is one pile of finished cards, out of the board.`,
		);
	}
	const pile = await store.archived();
	if (args.card !== undefined) {
		// `query` and `mine` narrow the pile, not the one card it would answer for.
		const ignored = cardFiltersRefusal(args, ["query", "mine"]);
		if (ignored !== undefined) return refusal(action, me, ignored);
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
	return textResult(formatArchive(shown, pile.skipped), {
		action,
		me,
		cards: shown,
		...(args.mine === true ? { mine: true } : {}),
	});
}

/** `add`: the only action that creates a card. */
async function add(
	store: BoardStore,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	const parsed = createInput({
		title: args.title,
		paths: args.paths,
		type: args.type,
		breaking: args.breaking,
		priority: args.priority,
		note: args.note,
	});
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
	/**
	 * What the call says besides the card: `next` after any successful write, and `told` only after
	 * one that changed something — a repeated sign is the same signature, and the owner does not
	 * need to hear it twice. Both the text and the transcript block carry the `told` line: the
	 * text as an indented continuation, the details as the sentence the one-line block draws.
	 */
	report: { next?: string; told?: (card: Card) => Promise<string | undefined> } = {},
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	if (args.card === undefined) return refusal(action, me, 'card is required: pass the id, e.g. "4".');
	const id = normalizeCardId(args.card);
	if (id === undefined) return refusal(action, me, `"${args.card}" is not a card id.`);
	const result = await store.mutate(id, op, me, now);
	if (!result.ok) return refusal(action, me, result.error, result.card);
	const told = result.changed ? await report.told?.(result.card) : undefined;
	const lines = [formatCard(result.card), ...(report.next === undefined ? [] : [report.next])];
	const announcement = told?.trim();
	return textResult([...lines, ...(told === undefined ? [] : [told])].join("\n"), {
		action,
		me,
		card: result.card,
		...(announcement === undefined ? {} : { told: announcement }),
	});
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
		if (!result.changed)
			return textResult(`${cardRef(id)} is already archived.`, {
				action: "archive",
				me,
				archive: { moved: [], kept: [], failed: [], already: id },
			});
		return textResult(formatArchived([id]), {
			action: "archive",
			me,
			archive: { moved: [id], kept: [], failed: [] },
		});
	}
	// One sweep, shared with `/board archive`: the numbers the rollup prints and the cards it
	// moves are one rule, and a finished card an open one still waits on is never taken. The
	// module is loaded here rather than at registration, like every surface a call opens.
	const { sweepFinished, sweepText } = await import("./archive.ts");
	const swept = await sweepFinished(store, me, now, await store.list());
	if (swept.moved.length === 0 && swept.failed.length === 0 && swept.kept.length === 0) {
		return textResult("No finished cards to archive.", {
			action: "archive",
			me,
			archive: { moved: [], kept: [], failed: [] },
		});
	}
	return textResult(sweepText(swept), { action: "archive", me, archive: swept });
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
