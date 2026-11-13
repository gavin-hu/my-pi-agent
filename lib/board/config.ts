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
import { loadConfigSection } from "../config.ts";
import { DEFAULT_TEAMMATES, normalizeTeammates } from "../session-label.ts";
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
