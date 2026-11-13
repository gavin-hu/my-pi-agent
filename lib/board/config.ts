/**
 * The `board` section of `bytefly.json`: the two numbers a lane is held to, the name a
 * signature has to carry, and the team those signatures belong to.
 *
 * All three are read together, once, when the store opens: a board that asked the file on
 * every write would spend a stat to answer a question nobody changed, and two readers of
 * one section are how the settings screen and the gate drift apart. The arithmetic of a
 * limit stays in `limits.ts`, the signer rule in `lead.ts`, and the team vocabulary in
 * `session-label.ts`; this module is the file.
 *
 * `extensions/bytefly` imports it too, so `/bytefly settings` shows what the loader keeps
 * rather than a declared copy of the default. That is allowed because it is `lib/`: a
 * shared body, not one extension reaching into another.
 */

import { asRecord } from "../json.ts";
import { loadConfigSection, projectConfigPath, writeConfigValueAt } from "../config.ts";
import { messageOf } from "../errors.ts";
import { sanitizeLine } from "../format.ts";
import { DEFAULT_TEAMMATES, isTeammate, normalizeTeammates, TEAMMATE_NAMES } from "../session-label.ts";
import { type Lead, normalizeLead } from "./lead.ts";
import { DEFAULT_WIP, normalizeWip, type WipLimits } from "./limits.ts";

/** What one board's `board` section says. */
export interface BoardConfig {
	/** How many cards `plan` and `execute` may hold. */
	wip: WipLimits;
	/** The team name whose signature satisfies the two gates. */
	lead: Lead;
	/**
	 * The team's names, in the order the file states them.
	 *
	 * A teammate is a name from the built-in vocabulary, and nothing else: the footer
	 * draws this session's name only when it is one of these, so the list is the one place
	 * a repository says who is on its team.
	 */
	teammates: readonly string[];
}

/**
 * The lead when nobody named one: the team's first name.
 *
 * A position rather than a second literal, so the default lead is always one of the default
 * teammates. A repository renames the lead with `board.lead`, and no module states a name
 * of its own — `lead.ts` knows the rule, `seat.ts` derives an id from the name, and this is
 * the one place a default is chosen.
 */
export const DEFAULT_LEAD: Lead = DEFAULT_TEAMMATES[0];

/** A board's settings when nobody said otherwise: three planning, five in flight, and the team. */
export const DEFAULT_BOARD_CONFIG: BoardConfig = {
	wip: DEFAULT_WIP,
	lead: DEFAULT_LEAD,
	teammates: DEFAULT_TEAMMATES,
};

/**
 * A board config as a caller writes one: the defaults, with whatever it states over them.
 *
 * A suite or a harness that cares about one key should not have to restate the rest — a new key
 * then lands in every literal that forgot it, which is what happened when the team arrived here.
 */
export function boardConfig(overrides: Partial<BoardConfig> = {}): BoardConfig {
	return { ...DEFAULT_BOARD_CONFIG, ...overrides };
}

/**
 * The settings a config section asks for.
 *
 * Each key falls back on its own, so a file that sets only `execute` keeps the ordinary `plan`
 * limit rather than a zero that would freeze the board, and one that sets only `lead` keeps both
 * numbers. The project's layer is normalized over the global one, so a key the nearer file does
 * not state keeps the farther file's answer.
 */
export function normalizeBoardConfig(
	raw: Record<string, unknown> | undefined,
	base: BoardConfig = DEFAULT_BOARD_CONFIG,
): BoardConfig {
	return {
		wip: normalizeWip(asRecord(raw?.wip), base.wip),
		lead: normalizeLead(raw?.lead, base.lead),
		teammates: normalizeTeammates(raw?.teammates, base.teammates),
	};
}

/** One board's settings: the project's `bytefly.json` over the global one. */
export function readBoardConfig(cwd: string, options: { agentDir?: string } = {}): BoardConfig {
	return loadConfigSection(cwd, "board", DEFAULT_BOARD_CONFIG, (raw, base) => normalizeBoardConfig(raw, base), options);
}

/**
 * What putting a name on the team did.
 *
 * `changed` is what a caller reports: a name the team already held is no edit at all, while a
 * name the vocabulary does not hold is refused rather than written and dropped on the next read.
 * The failure kinds are apart because a caller says different things about them — one is the
 * name the person typed, the other is the file that would not take it.
 */
export type AddTeammateResult =
	| { ok: true; team: readonly string[]; changed: boolean }
	| { ok: false; why: "not-a-teammate"; reason: string }
	| { ok: false; why: "write-failed"; reason: string };

/**
 * Put `label` on this repository's team, in the project's own `bytefly.json`.
 *
 * The team is read here rather than taken from the caller, because the one reader a caller
 * already holds is the store's: `config()` is what the file said when the store opened, so two
 * joins in one session would be decided against a list that had already lost the first one's
 * name. One file read on a typed command is cheaper than that.
 *
 * The write states the whole list, because the project's layer replaces the global one key by
 * key: a file that said only the new name would drop the rest of the team. Siblings (`lead`,
 * `wip`, the other sections, document metadata) survive `writeConfigValueAt`. Everything here is
 * an answer and nothing throws — a malformed document and a directory that cannot be written are
 * reasons the join stands without its name on the bar.
 */
export function addTeammate(cwd: string, label: string, options: { agentDir?: string } = {}): AddTeammateResult {
	const written = label.trim().toLowerCase();
	const name = TEAMMATE_NAMES.find((known) => known === written);
	if (name === undefined) {
		return { ok: false, why: "not-a-teammate", reason: `"${sanitizeLine(label)}" is not a preset teammate name` };
	}
	const team = readBoardConfig(cwd, options).teammates;
	if (isTeammate(name, team)) return { ok: true, team, changed: false };
	const next = [...team, name];
	try {
		writeConfigValueAt(projectConfigPath(cwd), "board", ["teammates"], next);
	} catch (error) {
		return { ok: false, why: "write-failed", reason: messageOf(error) };
	}
	return { ok: true, team: next, changed: true };
}
