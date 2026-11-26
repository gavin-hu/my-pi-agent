/**
 * What one `board` call does: the action it names, resolved into the store's write, the notice it
 * owes, and the result the transcript prints.
 *
 * One responsibility, and this sentence is what keeps it one: `tools.ts` keeps what a call *is* —
 * its registration and the text a model reads — while everything between a call's arguments and its
 * result lives here. The four card-write exports (`mutate`, `dropCard`, `reclaimOp`, `holderFact`)
 * are here because they are the ends of this dispatch rather than a second job: `write.ts` held them
 * with one importer, and a dispatch that chose an action but not the write it lands in would be a
 * seam with nothing on one side.
 */

import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveCwd } from "../../lib/env.ts";
import { attempt, messageOf } from "../../lib/errors.ts";
import { listOf } from "../../lib/format.ts";
import { busLoaded, createDeliver, type Deliver } from "../../lib/session-tool.ts";
import { strayField } from "../../lib/stray-fields.ts";
import { textResult } from "../../lib/tool-result.ts";
import { planForContract } from "../../lib/workflow/artifact.ts";
import { type Card, cardArg, normalizeCardId } from "../../lib/workflow/card.ts";
import type { Verification } from "../../lib/workflow/contract.ts";
import type { LandingVerdict } from "../../lib/workflow/landing.ts";
import { type Lane, movableLanes } from "../../lib/workflow/lanes.ts";
import type { CardOp } from "../../lib/workflow/rules.ts";
import type { BoardSession } from "../../lib/workflow/session.ts";
import { type HolderFact, signMark } from "../../lib/workflow/signs.ts";
import type { BoardStore, MutateResult } from "../../lib/workflow/store.ts";
import type { VerifyRun } from "../../lib/workflow/verify.ts";
import { CLAIM_NEXT, formatCard, formatDropped } from "./format.ts";
import { refusal } from "./result.ts";
import type { BoardArgs } from "./schema.ts";
import {
	ACTION_FIELDS,
	BOARD_ACTIONS,
	BOARD_TOOL,
	type BoardAction,
	type BoardDetails,
	normalizeBoardAction,
} from "./types.ts";

/**
 * The `reclaim` op, with the one fact its gate reads: what the bus says about the card's holder.
 *
 * The card is read here to learn whose record to ask about. The board's own read under the lock is
 * still the authority — `reclaim` keeps the fact only while it names the owner that read finds —
 * and a card that is not there, or a bus that cannot say, leaves the op with no fact at all: the
 * lead goes through and a peer is refused, which is the rule's answer when nothing is known.
 */
export async function reclaimOp(
	session: BoardSession,
	store: BoardStore,
	raw: string | undefined,
	cwd: string,
): Promise<CardOp> {
	return { kind: "reclaim", ...(await holderFact(session, store, raw, cwd)) };
}

/**
 * What the bus says about the session holding the card the caller named, when it can say.
 *
 * `undefined` is every ordinary answer — an id that cannot be read, a card with no owner, a bus that
 * could not answer — and the rule it feeds treats it as "cannot tell". One read, because both doors
 * that ask it (`reclaim`, and the lead's close of a card whose holder left) ask the same question
 * about the same card.
 */
export async function holderFact(
	session: BoardSession,
	store: BoardStore,
	raw: string | undefined,
	cwd: string,
): Promise<{ holder?: HolderFact }> {
	const id = raw === undefined ? undefined : normalizeCardId(raw);
	const card = id === undefined ? undefined : await store.read(id).catch(() => undefined);
	const holder = card === undefined ? undefined : await session.holder(cwd, card);
	return holder === undefined ? {} : { holder };
}

/**
 * Apply one op and report it: the card, the next step, the lane crossing's clause, and the sign's.
 *
 * The id the caller typed is normalized here, and a refusal carries the card the store left alone
 * so the next call starts from the truth. The crossing runs after the write for the same reason
 * the sign's message does: a bus that cannot answer must never cost the write it came after.
 */
export async function mutate(
	store: BoardStore,
	action: BoardAction,
	me: BoardDetails["me"],
	now: number,
	args: BoardArgs,
	op: CardOp,
	/**
	 * What the call says besides the card: `next` after any successful write, `told` when the result
	 * says a sign owes the owner its message, `ready` when it says a completed contract owes the lead
	 * one, and `cross` for the actions whose write can change a lane or an `execute` card's paths.
	 * `told` is not gated on the write: a repeat sign that stamped nothing still owes one while the
	 * card says the sign was never told.
	 *
	 * A write owes at most one of the two messages, because the operations that ask are disjoint — a
	 * sign cannot complete a contract and a contract cannot carry one — so the result's `told` is
	 * whichever line exists, and the body prints it once.
	 */
	report: {
		next?: string;
		/**
		 * The clause a write that owes a notice carries: who was told, or why nobody.
		 *
		 * Called only when the operation returned a `notice`, so a door never asks the bus about a
		 * write that owes nothing. The result comes with it because a reclaim's sentence describes
		 * the card as it was, which only `previous` holds.
		 */
		notice?: (card: Card, result: MutateResult) => Promise<{ card?: Card; line?: string } | undefined>;
		cross?: (result: MutateResult) => Promise<string | undefined>;
		/**
		 * The name the bus shows for the holder's session id, when the caller could read it.
		 *
		 * A row is a reading, so it prints the live name and leaves the record's label alone: a record
		 * that rewrote itself on every rename would race whoever else writes and still never reach a
		 * finished card.
		 */
		ownerLabel?: string;
	} = {},
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	const arg = cardArg(args.card);
	if ("error" in arg) return refusal(action, me, arg.error);
	const id = arg.id;
	const result = await store.mutate(id, op, me, now);
	if (!result.ok) return refusal(action, me, result.error, result.card);
	// One write owes at most one notice: the operation names which, and the door decides how.
	const notified =
		result.notice === undefined ? undefined : await report.notice?.(result.card, result).catch(() => undefined);
	// A notice the record settled is a card that moved: the announced write is the newer read.
	const card = notified?.card ?? result.card;
	// After the write, as the sign's message is: a bus that cannot answer costs a clause and
	// never the move it came after.
	const held = report.cross === undefined ? undefined : await report.cross(result).catch(() => undefined);
	// After the write: the card is taken either way, so a clause a bus cannot answer costs the
	// result a line rather than the move it came after.
	const toldLine = notified?.line;
	const row =
		report.ownerLabel === undefined || card.owner === undefined
			? card
			: { ...card, owner: { ...card.owner, label: report.ownerLabel } };
	const body = [
		formatCard(row),
		report.next,
		// The clause carries the continuation indent its neighbours do, the one `announce` writes
		// into its own sentence: a flush-left line under an indented card reads as a second card.
		held === undefined ? undefined : `  ${held}`,
		toldLine,
	].filter((line): line is string => line !== undefined);
	return textResult(body.join("\n"), {
		action,
		me,
		card,
		...(toldLine === undefined ? {} : { told: toldLine.trim() }),
		...(held === undefined ? {} : { held: held.trim() }),
	});
}

/** `drop`: the card and its notes leave together, so the report is the id. */
export async function dropCard(
	store: BoardStore,
	me: BoardDetails["me"],
	args: BoardArgs,
	now: number,
	cross: (result: MutateResult) => Promise<string | undefined>,
	ownerLabel?: string,
): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	const arg = cardArg(args.card);
	if ("error" in arg) return refusal("drop", me, arg.error);
	const id = arg.id;
	const op: CardOp = { kind: "drop", ...(ownerLabel === undefined ? {} : { ownerLabel }) };
	const result = await store.mutate(id, op, me, now);
	if (!result.ok) return refusal("drop", me, result.error, result.card);
	// A dropped card can carry the paths of work still in flight, and a claim nobody releases
	// would keep a peer off files that are no longer anybody's.
	const held = await cross(result).catch(() => undefined);
	return textResult([formatDropped(id), ...(held === undefined ? [] : [`  ${held}`])].join("\n"), {
		action: "drop",
		me,
		dropped: id,
		...(held === undefined ? {} : { held: held.trim() }),
	});
}

/**
 * The run a spot-check records, loaded at the first one: a board that never signs a card pays nothing
 * for the process seam it would need, and the registration graph stays where it is.
 */
let verifyModule: Promise<typeof import("../../lib/workflow/verify.ts")> | undefined;
// Loaded at the first sign, not at registration: a board that never signs pays nothing for the
// message, and the registration graph stays the size it was.
let notices: Promise<typeof import("./notices.ts")> | undefined;
// The same rule for the plan proof: `contract`, `move` and `approve` each ask for one, and a session
// that only lists cards pays nothing for the module that reads the plan store.
let proofModule: Promise<typeof import("./proof.ts")> | undefined;
// And for the landing door: one verb, its own module, loaded the first time the seat lands a card.
let landModule: Promise<typeof import("./land-action.ts")> | undefined;

/** What one call hands its dispatch: the tool's seams, the session it answers, and the arguments. */
export interface ActionInput {
	pi: ExtensionAPI;
	runtime: BoardSession;
	ctx: ExtensionContext;
	/** The dispatch's own seams: the notice it owes a person, and the check it runs for a sign. */
	deps: { notify?: Deliver; verify?: VerifyRun };
	args: BoardArgs;
}

/** One action, dispatched: the result the transcript prints, or the refusal that wrote nothing. */
export async function runAction(input: ActionInput): Promise<ReturnType<typeof textResult<BoardDetails>>> {
	const { pi, runtime, ctx, deps, args } = input;
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
	const known = await attempt(runtime.who(ctx, ctx.cwd));
	if ("error" in known) return refusal(action, { label: BOARD_TOOL }, known.error);
	const me = known.value;
	/** What `store.mutate` should be told about the card's plan, proved the way the tool proves it. */
	const proofOf = (store: BoardStore, rawCard: string | undefined, lane?: Lane, declared?: string) =>
		(proofModule ??= import("./proof.ts")).then((m) =>
			m.moveProofs(runtime, ctx.cwd, store, rawCard, lane, pi, declared),
		);
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
		root: string | undefined,
	): Promise<{ verified: Verification } | { error: string } | undefined> => {
		const id = rawCard === undefined ? undefined : normalizeCardId(rawCard);
		if (id === undefined) return undefined;
		const card = await store.read(id).catch(() => undefined);
		if (card === undefined) return undefined;
		// The gate, the override and the run are `lib/workflow/verify.ts`'s, so this door and the
		// person's ask one body where the command may start — the tree it runs in and the seams
		// it uses are the only things each knows.
		const module = await (verifyModule ??= import("../../lib/workflow/verify.ts"));
		return module.spotCheck({
			card,
			actor: me,
			lead: store.config().lead,
			override,
			// The note the sign will carry: the gate refuses one the card cannot keep before the
			// command starts, so a too-long note costs no run.
			note: args.note,
			// The tree the review names, or the session's own: `root` is the card's worktree (or a checkout
			// at its commit) when the signer is not in it. It is read now rather than taken from the store: a
			// store opened before `worktree enter` keeps the checkout it was opened on, so its root is the
			// wrong answer exactly when the reviewer has moved — `ctx.cwd` never moves at all.
			cwd: root === undefined ? resolveEffectiveCwd(ctx.cwd) : resolve(resolveEffectiveCwd(ctx.cwd), root),
			run: deps.verify ?? module.defaultVerifyRun(),
			now: () => runtime.now(),
			tree: module.treeOf(pi),
		});
	};
	try {
		// Before the join and before a card is read: a refused call has written nothing, so it
		// cannot have enlisted this session as a teammate on its way to the refusal.
		const stray = strayField(action, args, ACTION_FIELDS);
		if (stray !== undefined) return refusal(action, me, stray);
		const store = await runtime.store(ctx.cwd);
		const now = runtime.now();
		// The bus's name for the card's holder, read once for the whole call: every refusal that names a
		// holder prints it, and so does the row a write returns. `list` and `add` have no holder to name
		// — one shows the roster it already read, the other makes a card nobody holds yet — so they pay
		// nothing for it, and a bus that cannot answer leaves it absent for the rules to fall back.
		const ownerLabel =
			action === "list" || action === "add" ? undefined : await runtime.holderLabel(ctx.cwd, args.card);
		const labelled = ownerLabel === undefined ? {} : { ownerLabel };
		// One writer for every operation that names a card: the label rides both the op, which the rules
		// read, and the report, which prints the row — so a case cannot write one half and forget the
		// other, and the six arguments every one of them repeats are written once. `at` is the moment the
		// write is stamped: the call's own, except a spot-check's, which stamps after the command it ran.
		const write = <Op extends CardOp>(op: Op, report: Parameters<typeof mutate>[6] = {}, at = now) =>
			mutate(store, action, me, at, args, { ...op, ...labelled }, { ...report, ...labelled });
		switch (action) {
			case "list": {
				// The four answers live with the reads behind them, loaded on the call that asks for one.
				// The roster is passed rather than read there: a rename is a fact about the bus, so the
				// listing asks it once, and the rows carry the live name while the rollup folds the rest.
				// The plan store goes the same way: only a listing that names one card stats a plan, and
				// a card holds a name, so the store is what turns it back into a file.
				const { read } = await import("./listing.ts");
				return await read(
					store,
					action,
					me,
					args,
					now,
					() => runtime.roster(ctx.cwd),
					() => runtime.planDir(ctx.cwd),
				);
			}
			case "add":
				return await add(store, me, args, now);
			case "claim": {
				// A card's owner is a name peers resolve, so a claim belongs to a session the bus holds. The
				// question is the same one the tool list asks, asked again here because membership can go
				// inside a turn — a peer's `/team exit`, a record the heartbeat pruned — and with no bus
				// loaded there is no team to be on, so the solo board claims as it always has.
				// Loaded here, not at registration: a session that never claims pays nothing for it.
				if (busLoaded(pi)) {
					const { NOT_ON_TEAM, onTeam } = await import("../../lib/workflow/join.ts");
					if (!(await onTeam(runtime, ctx))) return refusal("claim", me, NOT_ON_TEAM);
				}
				return await write({ kind: "claim" }, { next: CLAIM_NEXT });
			}
			case "release":
				return await write({ kind: "release" }, { cross });
			case "reclaim":
				// The op carries what the bus says about the holder: the rule lets a peer take a card back
				// only from a session that has stopped, and the lead from anybody. A reclaim that takes the
				// card from somebody owes them a sentence, and it describes the card as it was.
				return await write(await reclaimOp(runtime, store, args.card, ctx.cwd), {
					cross,
					notice: async (card: Card, result) => {
						const { deliverNotice } = await (notices ??= import("./notices.ts"));
						const previous = result.ok && result.previous !== undefined ? result.previous : card;
						return await deliverNotice({
							kind: "reclaim",
							card: previous,
							lead: store.config().lead,
							by: me.label,
							ctx,
							deliver: deps.notify ?? createDeliver(pi),
							audience: { roster: () => runtime.roster(ctx.cwd), now: () => runtime.now() },
						});
					},
				});
			case "move": {
				const arg = cardArg(args.card);
				if ("error" in arg) return refusal(action, me, arg.error);
				// The proof and the holder fact take the caller's own spelling by name and normalize
				// inside, so this guard words the refusal and nothing is re-spelled here.
				const lane = args.lane;
				if (lane === undefined) {
					return refusal(action, me, `move needs a target lane: ${listOf(movableLanes())}.`);
				}
				// A landing the card names is validated before the chain is read: a bad argument costs no git
				// call, and the check that needs the branch stays in the rule.
				const declaration =
					args.landed === undefined ? undefined : await closingDeclaration(store, args.card, args.landed, me, lane);
				if (declaration !== undefined && "error" in declaration) return refusal(action, me, declaration.error);
				const { artifact: proved, landed } =
					lane === "execute" || lane === "done"
						? await proofOf(store, args.card, lane, declaration === undefined ? undefined : declaration.sha)
						: {};
				// Decided here, not in `applyOp`: the write must not import the landing module, so the
				// instruction arrives as an answer beside the verdict it answers for.
				const instruction =
					args.override === undefined
						? undefined
						: await closingInstruction(store, args.card, args.override, me, lane, landed);
				const op: CardOp = {
					kind: "move",
					lane,
					...(args.blockedBy === undefined ? {} : { blockedBy: args.blockedBy }),
					...(args.blocker === undefined ? {} : { blocker: args.blocker }),
					...(proved === undefined ? {} : { artifact: proved }),
					...(landed === undefined ? {} : { landed }),
					...(instruction === undefined ? {} : { instruction }),
					// A close is where a signed card went, and the lead may make it for a holder the bus
					// has lost: the one fact that door needs, read only for a `done`.
					...(lane === "done" ? await holderFact(runtime, store, args.card, ctx.cwd) : {}),
				};
				return await write(op, { cross });
			}
			case "note":
				return await write({ kind: "note", text: args.note });
			case "contract": {
				// The store is resolved here, and the path proved where the rule asks: only a caller holding the
				// working directory can say where the plan store is, and only the locked pass can say whether
				// the file is still there when the write lands.
				const file = args.path;
				const planDir = file === undefined ? undefined : await runtime.planDir(ctx.cwd);
				const plan = planDir === undefined || file === undefined ? undefined : () => planForContract(planDir, file);
				// The peer is the one session that knows its wording is ready, so the same write tells the lead:
				// resolved through the roster like a sign's addressee, and caught there, so a bus that cannot answer
				// costs a clause and never the contract it came after.
				const notice = async (card: Card): Promise<{ line?: string }> => {
					const { deliverNotice } = await (notices ??= import("./notices.ts"));
					return await deliverNotice({
						kind: "ready",
						card,
						lead: store.config().lead,
						ctx,
						deliver: deps.notify ?? createDeliver(pi),
						audience: { roster: () => runtime.roster(ctx.cwd), now: () => runtime.now() },
					});
				};
				return await write(
					{
						kind: "contract",
						...(plan === undefined ? {} : { artifact: plan }),
						goal: args.goal,
						acceptance: args.acceptance,
						scopeOut: args.scopeOut,
						verify: args.verify,
					},
					{ notice },
				);
			}
			case "approve":
			case "review": {
				const { settleNotice } = await (notices ??= import("./notices.ts"));
				// The name the sign will record, so the owner is told who signed rather than the
				// label the writing actor is called by.
				const signer = signMark(me, store.config().lead).by;
				// An approval covers the plan the card names as well as its wording, so it carries
				// the same proof a move does. A spot-check is about work already done, and the
				// `done` move proves the plan then, so it pays for nothing here.
				const artifact = action === "approve" ? (await proofOf(store, args.card)).artifact : undefined;
				// A spot-check of a card whose contract names a command is that command's run:
				// a refusal here writes nothing, which is what keeps a red check from signing.
				const evidence =
					action === "review" ? await verifiedFor(store, args.card, args.override, args.root) : undefined;
				if (evidence !== undefined && "error" in evidence) return refusal(action, me, evidence.error);
				// The one moment this sign is recorded at, read here and not at the top of the call: a
				// spot-check's command has a ten-minute bound, so a reading taken before it would stamp the
				// sign before its own evidence. One reading, because the message below writes the other half
				// of the same fact — `signStale` compares the later of the two, and a stale half would still
				// make a sign the work outgrew read as current.
				const at = runtime.now();
				// The store's `notice` is what says a message is owed — a fresh stamp, or a repeat sign
				// whose card still reads as never told. The roster is read here rather than up front so
				// a call the store refused pays nothing for it.
				const notice = async (card: Card): Promise<{ card?: Card; line?: string }> => {
					const settled = await settleNotice({
						store,
						card,
						kind: action,
						lead: store.config().lead,
						by: signer,
						actor: me,
						ctx,
						deliver: deps.notify ?? createDeliver(pi),
						at,
						audience: { roster: () => runtime.roster(ctx.cwd), now: () => runtime.now() },
					});
					return { card: settled.card, line: settled.line };
				};
				const op =
					action === "review"
						? {
								kind: "review" as const,
								text: args.note,
								override: args.override,
								...(evidence === undefined ? {} : { verified: evidence.verified }),
							}
						: { kind: "approve" as const, text: args.note, ...(artifact === undefined ? {} : { artifact }) };
				return await write(op, { notice }, at);
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
				return await write(
					{
						kind: "edit",
						title: args.title,
						paths: args.paths,
						type: args.type,
						breaking: args.breaking,
						priority: args.priority,
						dependsOn: args.dependsOn,
					},
					// An edit that changes an `execute` card's paths changes what it holds: the diff
					// claims what it added and releases what it removed.
					{ cross },
				);
			}
			case "drop":
				return await dropCard(store, me, args, now, cross, ownerLabel);
			case "land": {
				// The seat's one verb: its own module, because the fixed argv and the undo are more than
				// this dispatch should carry, and loaded here so a session that never lands pays nothing.
				const { landCardDoor } = await (landModule ??= import("./land-action.ts"));
				const landed = await landCardDoor({ pi, runtime, ctx, me, card: args.card });
				return landed.kind === "landed"
					? textResult(landed.text, { action, me, card: landed.card })
					: refusal(action, me, landed.error, landed.card);
			}
			case "archive":
				// The archive action lives with the sweep it runs, loaded when it is called.
				const { archiveCards } = await import("./archive.ts");
				return await archiveCards(store, me, args, now);
		}
	} catch (error) {
		return refusal(action, me, messageOf(error));
	}
}

/**
 * The instruction a close may carry, or the reason it is refused.
 *
 * Here rather than in `steps.ts` because the write must import no landing module: the decision is
 * made where the chain was read (the lazily loaded `proof.ts`) and this is its other half — the one
 * fact `proof.ts` cannot know, which is who is asking.
 */
async function closingInstruction(
	store: BoardStore,
	rawCard: string | undefined,
	raw: string,
	actor: BoardDetails["me"],
	lane: Lane,
	verdict: LandingVerdict | undefined,
): Promise<{ text: string } | { error: string } | undefined> {
	const { instructionFor } = await import("../../lib/workflow/landing.ts");
	const arg = cardArg(rawCard);
	const card = "error" in arg ? undefined : await store.read(arg.id);
	if (card === undefined) return undefined;
	return instructionFor({
		card,
		raw,
		actor,
		lead: store.config().lead,
		target: lane,
		...(verdict === undefined ? {} : { verdict }),
	});
}

/**
 * The landing a close may name, or the reason it is refused.
 *
 * Its other half is `proof.ts`'s: the shape and the permission are decided here because only this
 * side knows who is asking, and the chain's three checks are the rule's, where the branch was read.
 */
async function closingDeclaration(
	store: BoardStore,
	rawCard: string | undefined,
	raw: string,
	actor: BoardDetails["me"],
	lane: Lane,
): Promise<{ sha: string } | { error: string } | undefined> {
	const { declarationFor } = await import("../../lib/workflow/landing.ts");
	const arg = cardArg(rawCard);
	const card = "error" in arg ? undefined : await store.read(arg.id);
	if (card === undefined) return undefined;
	return declarationFor({ card, raw, actor, lead: store.config().lead, target: lane });
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
