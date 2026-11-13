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
import { planForContract, planIsGone } from "../../lib/board/artifact.ts";
import { type Card, cardRef, holds, matchesQuery, normalizeCardId } from "../../lib/board/card.ts";
import { movableLanes } from "../../lib/board/lanes.ts";
import { indexOf } from "../../lib/board/links.ts";
import type { Verification } from "../../lib/board/contract.ts";
import { signMark } from "../../lib/board/lead.ts";
import type { VerifyRun } from "../../lib/board/verify.ts";
import type { CardOp } from "../../lib/board/rules.ts";
import { buildRound } from "../../lib/board/round.ts";
import type { RosterSession } from "../../lib/session-roster.ts";
import type { BoardStore, MutateResult } from "../../lib/board/store.ts";
import { messageOf } from "../../lib/errors.ts";
import { listOf } from "../../lib/format.ts";
import { strayField } from "../../lib/stray-fields.ts";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { textResult } from "../../lib/tool-result.ts";
import { reuseText, toolDetails } from "../../lib/tui/chrome.ts";
import { callLine, detailsOrLine, isTailResult, TailResult } from "../../lib/tui/tool.ts";
import { formatRound } from "../../lib/board/round-text.ts";
import { CLAIM_NEXT, formatArchive, formatArchived, formatBoard, formatCard } from "./format.ts";
import { createTeamJoin, type TeamJoin } from "../../lib/session-tool.ts";
import { collapsedLine, refusal, resultInput } from "./result.ts";
import { dropCard, mutate, reclaimOp } from "./write.ts";
import type { Notify } from "./announce.ts";
import type { BoardSession } from "../../lib/board/session.ts";
import { type BoardArgs, BoardParams } from "./schema.ts";
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
	"A card moves through five lanes and carries its outcome, holder, " +
	"contract, plan, priority, type, breaking marker, links, and notes. " +
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

export function registerTools(
	pi: ExtensionAPI,
	runtime: BoardSession,
	deps: { team?: TeamJoin; notify?: Notify; verify?: VerifyRun } = {},
): void {
	const team = deps.team ?? createTeamJoin(pi);
	/**
	 * The run a spot-check records, loaded at the first one: a board that never signs a card pays
	 * nothing for the process seam it would need, and the registration graph stays where it is.
	 */
	let verifyModule: Promise<typeof import("../../lib/board/verify.ts")> | undefined;
	// Loaded at the first sign, not at registration: a board that never signs pays nothing for the
	// message, and the registration graph stays the size it was.
	let signMessage: Promise<typeof import("./announce.ts")> | undefined;
	// The same rule for the plan proof: `contract`, `move` and `approve` each ask for one, and a
	// session that only lists cards pays nothing for the module that reads the plan store.
	let proofModule: Promise<typeof import("./proof.ts")> | undefined;
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
			// The actor names every refusal below, and reading it fails like anything else can: a
			// failure is a refusal carrying the tool's own name, not a call the transcript cannot draw.
			const actor = await runtime.who(ctx, ctx.cwd).then(
				(known) => known,
				(error: unknown) => messageOf(error),
			);
			if (typeof actor === "string") return refusal(action, { label: BOARD_TOOL }, actor);
			const me = actor;
			/** What `store.mutate` should be told about the card's plan, proved the way the tool proves it. */
			const proofOf = (store: BoardStore, rawCard: string | undefined) =>
				(proofModule ??= import("./proof.ts")).then((module) => module.provedPlan(runtime, ctx.cwd, store, rawCard));
			/** The crossing this call can make, bound to its context once. */
			const cross = (result: MutateResult) => runtime.cross(ctx, result).catch(() => undefined);
			/**
			 * The run a spot-check records, when the card's contract names a command.
			 *
			 * The board executes nothing of its own: this call is the run, and the record it hands the
			 * store is evidence rather than an instruction. A card whose contract names nothing costs
			 * no process at all — the read is the same one `mutate` is about to make.
			 */
			const verifiedFor = async (
				store: BoardStore,
				rawCard: string | undefined,
				override: string | undefined,
			): Promise<{ verified: Verification } | { error: string } | undefined> => {
				const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
				if (id === undefined) return undefined;
				const card = await store.read(id).catch(() => undefined);
				if (card === undefined) return undefined;
				// The gate, the override and the run are `lib/board/verify.ts`'s, so this door and the
				// person's ask one body where the command may start — the tree it runs in and the seams
				// it uses are the only things each knows.
				const module = await (verifyModule ??= import("../../lib/board/verify.ts"));
				return module.spotCheck({
					card,
					actor: me,
					lead: store.config().lead,
					override,
					// The tree this session is working in, read now rather than taken from the store: a store
					// opened before `worktree enter` keeps the checkout it was opened on, so its root is the
					// wrong answer exactly when the reviewer has moved — `ctx.cwd` never moves at all.
					cwd: resolveEffectiveCwd(ctx.cwd),
					run: deps.verify ?? module.defaultVerifyRun(),
					now: () => runtime.now(),
					sha: module.shaOf(pi),
				});
			};
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
					case "claim":
						// Taking a card is what makes this session a teammate. It is the one action here worth
						// being addressed about, and the board is the user's surface for the team, so nobody has
						// to know the bus exists. A refused claim wrote nothing and enlists nobody, so the join is
						// the write's successor — and a join that did not land is a line on the result, because the
						// card it came after is already true.
						return await mutate(
							store,
							action,
							me,
							now,
							args,
							{ kind: "claim" },
							{
								next: CLAIM_NEXT,
								// Loaded here, not at registration: the join is the claim's side effect, so a session that
								// never claims pays nothing for it.
								joined: async () => {
									const { joinFailureLine, joinTeam } = await import("../../lib/board/join.ts");
									return joinFailureLine(await joinTeam(runtime, team, ctx, me.label));
								},
							},
						);
					case "release":
						return await mutate(store, action, me, now, args, { kind: "release" }, { cross });
					case "reclaim":
						// The op carries what the bus says about the holder: the rule lets a peer take a card back
						// only from a session that has stopped, and the lead from anybody.
						return await mutate(store, action, me, now, args, await reclaimOp(runtime, store, args.card, ctx.cwd), {
							cross,
						});
					case "move": {
						if (args.card === undefined) return refusal(action, me, 'card is required: pass the id, e.g. "4".');
						const lane = args.lane;
						if (lane === undefined) {
							return refusal(action, me, `move needs a target lane: ${listOf(movableLanes())}.`);
						}
						// `execute` and `done` carry the proof that the plan the card recorded is still
						// there, and a board outside a repository simply has no proof to check.
						const proved = lane === "execute" || lane === "done" ? await proofOf(store, args.card) : undefined;
						const op: CardOp = {
							kind: "move",
							lane,
							...(args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy }),
							...(args.blocker === undefined ? {} : { blocker: args.blocker }),
							...(proved === undefined ? {} : { artifact: proved }),
						};
						return await mutate(store, action, me, now, args, op, { cross });
					}
					case "note":
						return await mutate(store, action, me, now, args, { kind: "note", text: args.text });
					case "contract": {
						// The store is resolved here, and the path proved where the rule asks: only a caller holding the
						// working directory can say where the plan store is, and only the locked pass can say whether
						// the file is still there when the write lands.
						const file = args.path;
						const planDir = file === undefined ? undefined : await runtime.planDir(ctx.cwd);
						const plan = planDir === undefined || file === undefined ? undefined : () => planForContract(planDir, file);
						return await mutate(store, action, me, now, args, {
							kind: "contract",
							...(plan === undefined ? {} : { artifact: plan }),
							goal: args.goal,
							acceptance: args.acceptance,
							scopeOut: args.scopeOut,
							verify: args.verify,
						});
					}
					case "approve":
					case "review": {
						const { settleSign, notifyOverBus } = await (signMessage ??= import("./announce.ts"));
						// The name the sign will record, so the owner is told who signed rather than the
						// label the writing actor is called by.
						const signer = signMark(me, store.config().lead).by;
						// An approval covers the plan the card names as well as its wording, so it carries
						// the same proof a move does. A spot-check is about work already done, and the
						// `done` move proves the plan then, so it pays for nothing here.
						const artifact = action === "approve" ? await proofOf(store, args.card) : undefined;
						// A spot-check of a card whose contract names a command is that command's run:
						// a refusal here writes nothing, which is what keeps a red check from signing.
						const evidence = action === "review" ? await verifiedFor(store, args.card, args.override) : undefined;
						if (evidence !== undefined && "error" in evidence) return refusal(action, me, evidence.error);
						// The one moment this sign is recorded at, read here and not at the top of the call: a
						// spot-check's command has a ten-minute bound, so a reading taken before it would stamp the
						// sign before its own evidence. One reading, because the message below writes the other half
						// of the same fact — `signStale` compares the later of the two, and a stale half would still
						// make a sign the work outgrew read as current.
						const at = runtime.now();
						// The store's `announce` is what says a message is owed — a fresh stamp, or a repeat
						// sign whose card still reads as never told. The roster is read here rather than up
						// front so a call the store refused pays nothing for it.
						const told = async (card: Card): Promise<{ card?: Card; line?: string }> => {
							const settled = await settleSign({
								store: async () => store,
								card,
								sign: action,
								by: signer,
								actor: me,
								ctx,
								notify: deps.notify ?? notifyOverBus(pi),
								at,
								audience: { roster: () => runtime.roster(ctx.cwd), now: () => runtime.now() },
							});
							return { card: settled.card, line: settled.line };
						};
						const op =
							action === "review"
								? {
										kind: "review" as const,
										text: args.text,
										override: args.override,
										...(evidence === undefined ? {} : { verified: evidence.verified }),
									}
								: { kind: "approve" as const, text: args.text, ...(artifact === undefined ? {} : { artifact }) };
						return await mutate(store, action, me, at, args, op, { told });
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
						return await dropCard(store, me, args, now, cross);
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
	// One read of the pile answers both questions a listing asks — the cards, and the files the
	// reader refused, which is the difference between "not there" and "there, and unreadable".
	const { cards, skipped } = await store.scan();
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
		// The one stat a read can afford, and the only card it can afford it on: a listing's rows carry
		// no plan line, so this is where a reader learns the file it would move on is already gone.
		return textResult(formatCard(card, indexOf(cards), now, planIsGone(card)), { action, me, card });
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
	// Loaded here rather than at registration: `add` is the only caller, and a session that
	// never adds a card pays nothing for the argument boundary.
	const { createInput } = await import("./input.ts");
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
