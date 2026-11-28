/**
 * Whether a held card lets this session write: one table, keyed by the lane.
 *
 * The rule the workflow states — claim, plan, contract, sign, then `execute` before editing —
 * used to have no gate. The only barrier was plan *mode*, which is a property of the session and
 * ends at approval, before the card crosses into `execute`; a session that never entered plan
 * mode (resumed, non-interactive, `plan` toggled off) had no barrier at all. So the key here is
 * the card's lane, which is the record rather than a mode, and it is read from the cards the
 * session already holds (`context.ts`'s `heldCards`).
 *
 * The leash therefore begins at `claim`: `card.ts` keeps a card in the pool ownerless, so a
 * backlog card is never in `held` and nothing here can see it. A session whose work is still
 * unclaimed is gated by nothing, which is why the step before this table — whether there is a
 * card at all — is `enter-gate.ts`'s question and not a branch of this one.
 *
 * What this deliberately is not: a sandbox. A shell command under an `execute` card is judged by
 * lane and not by path, because a shell's effect is not decidable; a session holding no card
 * writes exactly as it always did, because a board must never brick work that is not its own; and
 * a `done` card gates nothing, because what comes after a finished card is `next`'s business.
 *
 * Value-only apart from path resolution through `lib/path.ts`, and that is the same resolution a
 * claim takes (`extensions/session-bus/resolve.ts`), so a card's `paths` mean one thing to the
 * gate and another to nobody.
 */

import { resolve } from "node:path";
import { type ModePhrasing, readOnlyBashRefusal } from "../../lib/git/read-command.ts";
import { isInsideReal } from "../../lib/path.ts";
import { type Card, cardRef } from "../../lib/workflow/card.ts";
import { contractRoute } from "../../lib/workflow/lanes.ts";
import { BASH_TOOL, EDIT_TOOL, SUBAGENT_TOOL, WRITE_TOOL } from "../../lib/tool-names.ts";

/** The one shell with no read-only form: it is judged by lane, and never by the git grammar. */
const POWERSHELL_TOOL = "powershell";

/** The board's own words for the shell guard, so its refusals read like the rest of the board's. */
const BOARD_PHRASING: ModePhrasing = { label: "board", whileDoing: "for a card outside execute" };

/** One tool call as the gate reads it: the name, and the parameters it would run with. */
export interface GateCall {
	/** The registered tool's name. */
	tool: string;
	/** The call's parameters, mutated when a `subagent` is pinned read-only. */
	input: unknown;
}

/** What the gate needs from the session it judges for. */
export interface GateDeps {
	/**
	 * The worktree the card's `paths` resolve against: the store's `root()`, which is the
	 * repository the hints are written relative to and the one a claim resolves against.
	 */
	root: string;
	/**
	 * Pin a `subagent` call read-only, or say why it cannot be pinned. One body, in
	 * `lib/policy.ts`, shared with plan mode; the gate does not spell the probe again.
	 */
	pinSubagent: (input: unknown) => string | undefined;
}

/**
 * Why this session may not make `call`, or `undefined` when it may.
 *
 * The cards decide and nothing else: a session holding no card in `plan`, `blocked`, or
 * `execute` is the ordinary answer — a card in the pool has no holder, so it is not in `held` at
 * all — and so is every tool this table does not judge — the board, session, team, plan, todo, and
 * goal verbs are how a card leaves its lane, and a refusal that trapped a session in one would be
 * a board nobody could use.
 */
export function writeRefusal(held: readonly Card[], call: GateCall, deps: GateDeps): string | undefined {
	const live = held.filter((card) => card.lane !== "done");
	if (live.length === 0) return undefined;
	const executing = live.filter((card) => card.lane === "execute");
	if (executing.length > 0) {
		const scoped = call.tool === WRITE_TOOL || call.tool === EDIT_TOOL;
		return scoped ? scopeRefusal(executing, call.input, deps.root) : undefined;
	}
	// Nothing is in execute, so the card is on its way there and the work is not this session's to
	// start yet. The first card is named because a session holds one card; a second would be a bug
	// the lane cap already refuses.
	const card = live[0];
	if (call.tool === WRITE_TOOL || call.tool === EDIT_TOOL) return laneRefusal(card, "a file write");
	if (call.tool === SUBAGENT_TOOL) {
		const unpinned = deps.pinSubagent(call.input);
		return unpinned === undefined ? undefined : subagentRefusal(card, unpinned);
	}
	if (call.tool === BASH_TOOL) return shellRefusal(card, call.input);
	if (call.tool === POWERSHELL_TOOL) return laneRefusal(card, "a PowerShell command");
	return undefined;
}

/** The refusal for a `write`/`edit` outside every `execute` card's `paths`, or `undefined` inside one. */
function scopeRefusal(executing: readonly Card[], input: unknown, root: string): string | undefined {
	const requested = pathOf(input);
	if (requested === undefined) return undefined;
	// An unscoped card names no paths, and the session that wrote it chose not to say where the
	// work happens; the gate says nothing it cannot know rather than inventing a boundary.
	const scoped = executing.filter((card) => card.paths.length > 0);
	if (scoped.length === 0) return undefined;
	const target = resolve(root, requested);
	if (!isInsideReal(root, target)) {
		return `board: ${requested} is outside the worktree, so no card's paths can name it.`;
	}
	if (scoped.some((card) => card.paths.some((hint) => isInsideReal(resolve(root, hint), target)))) return undefined;
	const card = scoped[0];
	const named = card.paths.map((path) => `\`${path}\``).join(", ");
	return `board: ${cardRef(card.id)} in execute names ${named}; ${requested} is outside them — \`board edit ${card.id} paths [...]\` adds it.`;
}

/** The refusal for a `bash` call the lane does not allow, or `undefined` when it is read-only git. */
function shellRefusal(card: Card, input: unknown): string | undefined {
	// The one body plan mode also runs: an empty command, the git grammar, and the approved command
	// written back onto the call.
	const reason = readOnlyBashRefusal(input, BOARD_PHRASING, `${routeSentence(card)} ${exitSentence(card)}`);
	return reason === undefined ? undefined : `board: ${capitalized(reason)}`;
}

/** The refusal for a `subagent` the lane cannot pin read-only. */
function subagentRefusal(card: Card, unpinned: string): string {
	return `board: ${cardRef(card.id)} is in ${card.lane}; ${unpinned} ${routeSentence(card)} ${exitSentence(card)}`;
}

/** The whole refusal for a call the card's lane does not allow. */
function laneRefusal(card: Card, what: string): string {
	return `board: ${cardRef(card.id)} is in ${card.lane}; ${what} needs the card in execute. ${routeSentence(card)} ${exitSentence(card)}`;
}

/** What still stands between the card and execute, as the one clause that ends the refusal. */
function routeSentence(card: Card): string {
	if (card.contract?.approved === undefined) return `${capitalized(contractRoute(card))} Approval clears it.`;
	return `\`board move ${card.id} execute\` clears it.`;
}

/** The escape hatch: a session that is not doing this card's work releases it and writes. */
function exitSentence(card: Card): string {
	return `Or \`board release ${card.id}\` to work without it.`;
}

/** `sentence` with its first letter up, because it follows a full stop or a colon. */
function capitalized(sentence: string): string {
	return `${sentence.slice(0, 1).toUpperCase()}${sentence.slice(1)}`;
}

/** The path a `write`/`edit` call names, when it names one. */
function pathOf(input: unknown): string | undefined {
	const path = (input as { path?: unknown } | undefined)?.path;
	return typeof path === "string" && path !== "" ? path : undefined;
}
