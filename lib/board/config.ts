/**
 * The `board` section of `bytefly.json`: the two numbers a lane is held to, and the name a
 * signature has to carry.
 *
 * Both are one setting because they are read together, once, when the store opens: a board that
 * asked the file on every write would spend a stat to answer a question nobody changed, and two
 * readers of one section are how the settings screen and the gate drift apart. The arithmetic of
 * a limit stays in `limits.ts` and the signer rule stays in `lead.ts`; this module is the file.
 *
 * `extensions/bytefly` imports it too, so `/bytefly settings` shows what the loader keeps rather
 * than a declared copy of the default. That is allowed because it is `lib/`: a shared body, not
 * one extension reaching into another.
 */

import { asRecord, loadConfigSection } from "../config.ts";
import { DEFAULT_LEAD, type Lead, normalizeLead } from "./lead.ts";
import { DEFAULT_WIP, normalizeWip, type WipLimits } from "./limits.ts";

/** What one board's `board` section says. */
export interface BoardConfig {
	/** How many cards `plan` and `execute` may hold. */
	wip: WipLimits;
	/** The team name whose signature satisfies the two gates. */
	lead: Lead;
}

/** A board's settings when nobody said otherwise: three planning, five in flight, and the lead. */
export const DEFAULT_BOARD_CONFIG: BoardConfig = { wip: DEFAULT_WIP, lead: DEFAULT_LEAD };

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
	return { wip: normalizeWip(asRecord(raw?.wip), base.wip), lead: normalizeLead(raw?.lead, base.lead) };
}

/** One board's settings: the project's `bytefly.json` over the global one. */
export function readBoardConfig(cwd: string, options: { agentDir?: string } = {}): BoardConfig {
	return loadConfigSection(cwd, "board", DEFAULT_BOARD_CONFIG, (raw, base) => normalizeBoardConfig(raw, base), options);
}
