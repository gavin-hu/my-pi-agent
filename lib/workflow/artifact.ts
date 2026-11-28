/**
 * Whether a path is a plan of this repository: the board's half of the plan store.
 *
 * The board records the plan a card is executed against, and that record is only worth
 * something if the file is the one `plan` wrote. The board does not parse a plan — it
 * resolves the path the model passed, requires it to be inside this repository's plan
 * store, and requires it to be there. So a contract cannot name a path to nothing, and a
 * card cannot enter `execute` on a plan somebody deleted after recording it.
 *
 * Two sentences per refusal, because the two moments ask different questions. At `contract`
 * the question is "may this be recorded", and the way out is "write the plan, then pass the
 * path it returned". At `execute` or `done` the question is "is the plan it recorded still
 * there", and the way out follows the card's lane — a card in `plan` can record again, and
 * one already executing has to come back to `plan` first, which is why {@link contractRoute}
 * is here rather than in each caller. One resolution body answers both: the store's rules
 * come from `plans/paths.ts`, so the board and the plan tool cannot disagree about what a
 * plan path is. And a third at `contract`, asked of the cards rather than the store: whether
 * the file is already some other card's — {@link planCollision}.
 *
 * The board still never reads a plan. A `stat` is the whole check, which is why this module
 * is the only place the board touches the plan store.
 *
 * What the card keeps is the plan's name inside the store, not the path this host resolved it
 * to: a store lives under this host's agent directory, so a path is a fact about one machine,
 * while a name is the half another host can join to its own store.
 */

import { statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { sanitizeLine, shortenPath } from "../format.ts";
import { isInside } from "../path.ts";
import { isContainedPlan, isPlanFileName, legacyPlanStore, resolvePlanArg } from "../plans/paths.ts";
import type { Card } from "./card.ts";
import { cardRef } from "./card.ts";
import { contractRoute } from "./lanes.ts";

/** The plan a card is executed against, proved to exist in this host's store. */
export interface PlanArtifact {
	/**
	 * What the card records for this plan: the fact's own subject, and the one thing the gate compares.
	 *
	 * A contract carries the plan's name inside the store — `2026-10-26-1008-the-query.md`, not
	 * `~/.pi/agent/plans/<key>/…` — which is what makes the record portable, because every host
	 * joins a name to its own store. A re-check carries the record the card already holds, verbatim,
	 * so a fact proved for one record cannot open a card whose record is another, and a card whose
	 * plan changed between the read and the write is refused rather than forced. A record written
	 * before names were kept is an absolute path, and comes back as it was read.
	 */
	record: string;
}

/**
 * The resolved path, or the sentence refusing it.
 *
 * A union rather than two fields, so the tool hands the state machine one fact and the
 * state machine decides which refusal a caller hears first — an owner-check that fails
 * should be heard before a path that does not resolve.
 */
export type ArtifactCheck = PlanArtifact | { error: string };

/**
 * What a caller knows about a card's plan, or the way to find out.
 *
 * A door proves a plan before `store.mutate` is called, and the board's lock is taken after that:
 * the fact a door holds is a fact about a moment the write has already left. So a door hands over
 * the question instead, and the rule asks it where the answer is needed — `applyOp` runs inside the
 * locked pass, so the stat happens there by construction and the store never has to know where the
 * plan store is. A caller that already holds an answer may still hand the fact itself.
 */
export type ArtifactProof = ArtifactCheck | (() => ArtifactCheck);

/** The fact itself, taking the question now. */
export function proved(proof: ArtifactProof): ArtifactCheck {
	return typeof proof === "function" ? proof() : proof;
}

/**
 * The plan's name inside the store: the store-relative half a card keeps.
 *
 * `relative` and not the basename, so a plan recorded in a subdirectory of the store stays there.
 */
function storeName(planDir: string, path: string): string {
	return relative(planDir, path);
}

/** What is inside the store at a resolved path. */
type Located =
	/** Not inside the store at all, or reached through a link that leaves it. */
	| { kind: "outside"; path: string }
	/** Inside the store, but not a markdown plan file. */
	| { kind: "named"; path: string }
	/** A plan name; what is at it, if anything. */
	| { kind: "plan"; path: string; file: boolean; present: boolean };

/** Resolve `rawPath` against `planDir`, and say what the store holds there. */
function locate(planDir: string, rawPath: string): Located {
	const path = resolvePlanArg(planDir, rawPath);
	if (!isContainedPlan(planDir, path)) {
		// `isContainedPlan` answers both questions at once, so the name rule is asked again
		// here: a `.txt` in the store deserves the sentence about its name, not about a link.
		return isInside(planDir, path) && !isPlanFileName(path) ? { kind: "named", path } : { kind: "outside", path };
	}
	return { kind: "plan", path, ...presentAt(path) };
}

/**
 * A **recorded** path, which may name the flat tree the store replaced.
 *
 * #771 moved the plan store, so a record written before it names a path in `<agent-dir>/plans`:
 * for one release that tree is still read, or a card the mover has not reached would read as
 * gone and be refused at `execute`. Only a path can name it — a bare name is a name in *this*
 * store, because the flat tree is where nothing new is written — and the current store answers
 * first, so a record that names a plan in both is read where plans live now.
 */
function locateRecorded(planDir: string, rawPath: string): Located {
	const here = locate(planDir, rawPath);
	if (isName(rawPath) || (here.kind === "plan" && here.present)) return here;
	const legacy = legacyPlanStore(planDir);
	if (legacy === undefined) return here;
	const there = locate(legacy, rawPath);
	// The store the record names answers, present or not: a plan the flat tree has lost is "gone",
	// not "outside", and a sentence about the wrong refusal sends a reader to the wrong repair.
	return there.kind === "outside" ? here : there;
}

/** Whether a record is a name inside a store rather than a path one host resolved. */
function isName(rawPath: string): boolean {
	const text = rawPath.trim();
	return !isAbsolute(text) && !text.startsWith("~");
}

/** Whether something is at a path, and whether it is a file. */
function presentAt(path: string): { present: boolean; file: boolean } {
	try {
		return { present: true, file: statSync(path).isFile() };
	} catch {
		return { present: false, file: false };
	}
}

/** One path as a refusal prints it: shortened, and never more than one line. */
function at(path: string): string {
	return sanitizeLine(shortenPath(path));
}

/** What `contract` may record: a plan of this repository, already written. */
export function planForContract(planDir: string, rawPath: string): ArtifactCheck {
	const found = locate(planDir, rawPath);
	if (found.kind === "outside") {
		return {
			error: `${at(found.path)} is not in this repository's plan store; \`plan\` action \`write\` saves into ${at(planDir)}.`,
		};
	}
	if (found.kind === "named") {
		return { error: `${at(found.path)} is not a markdown plan; \`plan\` action \`write\` saves into ${at(planDir)}.` };
	}
	if (!found.present) {
		return {
			error: `${at(found.path)} does not exist; \`plan\` action \`write\` saves the plan, and \`contract\` records the path it returns.`,
		};
	}
	if (!found.file)
		return { error: `${at(found.path)} is not a file; record the markdown file \`plan\` action \`write\` saves.` };
	return { record: storeName(planDir, found.path) };
}

/**
 * What a card may enter `execute` or `done` on: the plan it recorded, still in the store.
 *
 * The record may predate this rule — a card written when any string was accepted — which is
 * why an outside path refuses here with the same route out as a missing file, and why what
 * comes back is the record as the card spelled it: a name on a card that kept one, an absolute
 * path on a card written before names were kept.
 */
export function planForExecute(planDir: string, card: Pick<Card, "id" | "lane" | "planPath">): ArtifactCheck {
	const rawPath = card.planPath ?? "";
	const found = locateRecorded(planDir, rawPath);
	const route = ` ${contractRoute(card)}`;
	if (found.kind === "outside") {
		return { error: `${cardRef(card.id)}'s plan is outside this repository's plan store (${at(rawPath)});${route}` };
	}
	if (found.kind === "named") {
		return { error: `${cardRef(card.id)}'s recorded plan is not a markdown file (${at(rawPath)});${route}` };
	}
	if (!found.present) {
		return { error: `the plan recorded for ${cardRef(card.id)} is gone (${at(found.path)});${route}` };
	}
	if (!found.file) {
		return { error: `the plan recorded for ${cardRef(card.id)} is not a file (${at(found.path)});${route}` };
	}
	return { record: rawPath };
}

/**
 * Why a card's plan requirement is not met, or `undefined` when it is.
 *
 * The whole of the `artifact` requirement a move asks: the three sentences a missing plan, an
 * unproved one and a proof bound to another record are refused with, and the comparison of the
 * record the proof names with the one the card holds. It lives here because it is entirely about
 * the plan store's fact; `steps.ts`'s `unmet` asks it with the proof the caller handed in, and
 * `approve` asks the same question through the same switch.
 */
export function artifactRefusal(card: Card, artifact: ArtifactProof | undefined): string | undefined {
	if (card.planPath === undefined) {
		return `${cardRef(card.id)} has no plan recorded; ${contractRoute(card)}`;
	}
	// Fail closed: a lane that requires a proved plan refuses when the caller did not hand one in,
	// so a surface added later cannot pass the gate by forgetting it. A check that failed speaks
	// with its own sentence, built where the file was read.
	if (artifact === undefined) {
		return `${cardRef(card.id)}'s plan was not checked; ${contractRoute(card)}`;
	}
	// The caller hands over the question, not the answer: `applyOp` runs inside the store's lock,
	// so this is the stat taken there — a file deleted while the write waited is refused here.
	const check = proved(artifact);
	if ("error" in check) return check.error;
	// The proof is bound to the record it was computed for: a fact about one path cannot open a card
	// whose path is another, and a plan re-recorded between the read and the write is a card to read
	// again rather than one to force. The record is the card's own string, a store-relative name for
	// a card this build wrote and an absolute path for one written before names were kept, so the two
	// spellings of one plan cannot match.
	return check.record === card.planPath
		? undefined
		: `${cardRef(card.id)}'s plan changed while it was being read; ${contractRoute(card)}`;
}

/**
 * Why a card may not record a plan file another card already records, or `undefined` when it may.
 *
 * `contract` is the one step that points a card at a file, and a file is one card's: a second card
 * recording it would let a re-plan elsewhere rewrite the bytes whose wording a peer approved, and
 * nothing downstream notices — {@link planIsGone} asks whether the file is *there*, and
 * {@link artifactRefusal} compares the recorded name rather than its contents. The card's own record
 * is skipped, because that is the re-plan and the sign it drops is its own.
 *
 * It lives here rather than beside `indexOf` in `links.ts`, although it reads cards and no plan store:
 * the question is what a recorded plan belongs to, {@link artifactRefusal} next door is the precedent
 * for that half living here, and `links.ts` owns what a card's *other* fields point at.
 */
export function planCollision(card: Pick<Card, "id">, record: string, cards: Iterable<Card>): string | undefined {
	for (const other of cards) {
		if (other.id === card.id || other.planPath !== record) continue;
		return `${cardRef(card.id)} would record the plan ${cardRef(other.id)} holds; a plan is one card's, and \`plan\` action \`write\` saves a new name — record the one it returns.`;
	}
	return undefined;
}

/**
 * Whether a card's recorded plan is gone, where that is a fact worth drawing.
 *
 * `plan` and `execute` only: entering `execute` and entering `done` are the two moments the gate
 * asks, so a card there can still be rescued by recording its plan again. The pool's cards re-plan
 * on the next claim, and a finished card is history — so neither is stat'ed for a face that could
 * not act on the answer.
 *
 * The record is resolved through the store before the stat, the way the gate resolves it: a name
 * means nothing on its own, and a badge drawn by stat'ing one against the working directory would
 * call every named plan gone.
 */
export function planIsGone(planDir: string, card: Pick<Card, "id" | "lane" | "planPath">): boolean {
	if (card.planPath === undefined) return false;
	if (card.lane !== "plan" && card.lane !== "execute") return false;
	// The same resolution the gate makes, including the flat tree a record may still name: a badge
	// that read a readable plan as gone would send a reader to re-record a plan nothing lost.
	const found = locateRecorded(planDir, card.planPath);
	return !(found.kind === "plan" && found.present && found.file);
}

/**
 * The ids of the cards whose recorded plan is gone: one pass, for the snapshot that draws them.
 *
 * Pure per card and silent about what it means — the reason line and the card block say that —
 * so a caller with one card may ask {@link planIsGone} and reach the same answer. The store is a
 * parameter for the same reason it is one there: the answer is a stat on a name it resolves.
 */
export function gonePlans(planDir: string, cards: readonly Pick<Card, "id" | "lane" | "planPath">[]): Set<string> {
	const gone = new Set<string>();
	for (const card of cards) {
		if (planIsGone(planDir, card)) gone.add(card.id);
	}
	return gone;
}
