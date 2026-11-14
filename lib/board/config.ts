/**
 * The `team` and `board` sections of `bytefly.json`: the names a signature belongs to, and the
 * two numbers a lane is held to.
 *
 * Both are read when the store opens: a board that asked the file on every write would spend a
 * stat to answer a question nobody changed, and two readers of one section are how the settings
 * screen and the gate drift apart. The team has a default rather than a vocabulary: one lead and
 * five names, so a repository that states nothing has a signer and a name to draw, while a file's
 * own answer — `[]` included — replaces it whole. The arithmetic of a limit stays in `limits.ts`,
 * the signer rule in `lead.ts`, and the label rules in `session-label.ts`; this module is the file.
 *
 * `extensions/bytefly` imports it too, so `/bytefly settings` shows what the loader keeps rather
 * than a declared copy of the default. That is allowed because it is `lib/`: a shared body, not
 * one extension reaching into another.
 */

import { asRecord } from "../json.ts";
import { loadConfigSection, projectConfigPath, writeConfigValueAt } from "../config.ts";
import { messageOf } from "../errors.ts";
import { isTeammate, normalizeLabel, normalizeTeammates } from "../session-label.ts";
import { type Lead, normalizeLead } from "./lead.ts";
import { DEFAULT_WIP, normalizeWip, type WipLimits } from "./limits.ts";

/** What a project's `team` section says: who signs, and who is on the team. */
export interface TeamConfig {
	/** The team name whose signature satisfies the two gates; empty only when a file states none. */
	lead: Lead;
	/**
	 * The team's names, in the order they are drawn or stated.
	 *
	 * `DEFAULT_TEAM_CONFIG` fills this when no file names a team; a file that states a list replaces
	 * it whole, and an empty list is a team of nobody — the footer draws a session's name only when it
	 * is one of these, so a project that states none draws no chip. The list is the one place a
	 * repository says who is on its team.
	 */
	teammates: readonly string[];
}

/**
 * The team a project starts with: the name whose signature the gates take, and five names to draw.
 *
 * A default rather than a vocabulary — a file states the team it wants, `[]` included, and this is
 * only what a file that states nothing leaves. The lead is a name, not a role: only a session
 * called `gavin` signs. A session may not take the lead's own name, so `tom` is the first name a
 * nameless one draws — and a repository holding all five still reaches `agentLabel`'s
 * `team-agent-<id>`, the name nobody holds.
 */
export const DEFAULT_TEAM_CONFIG: TeamConfig = { lead: "gavin", teammates: ["gavin", "tom", "jack", "mike", "sam"] };

/** What one board's `board` and `team` sections say together. */
export interface BoardConfig extends TeamConfig {
	/** How many cards `plan` and `execute` may hold. */
	wip: WipLimits;
}

/** A board's settings when nobody said otherwise: three planning, five in flight, and the default team. */
export const DEFAULT_BOARD_CONFIG: BoardConfig = { ...DEFAULT_TEAM_CONFIG, wip: DEFAULT_WIP };

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
 * The settings a `team` section asks for.
 *
 * Each key falls back on its own, so a file that sets only `lead` keeps the team it was given and
 * one that sets only `teammates` keeps its lead. The project's layer is normalized over the
 * global one, so a key the nearer file does not state keeps the farther file's answer. A key the
 * file does state is taken as written — including an empty list, which is a project saying what
 * its team is rather than a file that said nothing.
 */
export function normalizeTeamConfig(
	raw: Record<string, unknown> | undefined,
	base: TeamConfig = DEFAULT_TEAM_CONFIG,
): TeamConfig {
	return {
		lead: normalizeLead(raw?.lead, base.lead),
		teammates: normalizeTeammates(raw?.teammates, base.teammates),
	};
}

/** The limits a `board` section asks for, each clamped into range. */
export function normalizeWipConfig(raw: Record<string, unknown> | undefined, base: WipLimits = DEFAULT_WIP): WipLimits {
	return normalizeWip(asRecord(raw?.wip), base);
}

/** The team a project states: the project's `team` section over the global one. */
export function readTeamConfig(cwd: string, options: { agentDir?: string } = {}): TeamConfig {
	return loadConfigSection(cwd, "team", DEFAULT_TEAM_CONFIG, normalizeTeamConfig, options);
}

/** One board's settings: the team it belongs to, and the limits its lanes are held to. */
export function readBoardConfig(cwd: string, options: { agentDir?: string } = {}): BoardConfig {
	return {
		...readTeamConfig(cwd, options),
		wip: loadConfigSection(cwd, "board", DEFAULT_WIP, normalizeWipConfig, options),
	};
}

/**
 * What putting a name on the team did.
 *
 * `changed` is what a caller reports: a name the team already held is no edit at all, and a write
 * that cannot land is a reason the join stands without its name on the bar. Both are answers and
 * neither throws, because a malformed document is not the join's failure to report.
 */
export type AddTeammateResult =
	| { ok: true; team: readonly string[]; changed: boolean }
	| { ok: false; why: "write-failed"; reason: string };

/**
 * Put `label` on this repository's team, in the project's own `bytefly.json`.
 *
 * Any name a label can be is a teammate: the team's list is the vocabulary, so the only rule a
 * write has is the one every label has — one line, trimmed, and capped. The team is read here
 * rather than taken from the caller, because the one reader a caller already holds is the
 * store's: `config()` is what the file said when the store opened, so two joins in one session
 * would be decided against a list that had already lost the first one's name. One file read on a
 * typed command is cheaper than that.
 *
 * The write states the whole list, because a stated list replaces the layer under it whole: the
 * default five when the project states no team, and the global file's names when the project
 * states none of its own. A file that said only the new name would drop the rest of the team.
 * Siblings (`lead`, other sections, document metadata) survive `writeConfigValueAt`.
 */
export function addTeammate(cwd: string, label: string, options: { agentDir?: string } = {}): AddTeammateResult {
	const name = normalizeLabel(label, "").toLowerCase();
	const team = readTeamConfig(cwd, options).teammates;
	if (name === "" || isTeammate(name, team)) return { ok: true, team, changed: false };
	const next = [...team, name];
	try {
		writeConfigValueAt(projectConfigPath(cwd), "team", ["teammates"], next);
	} catch (error) {
		return { ok: false, why: "write-failed", reason: messageOf(error) };
	}
	return { ok: true, team: next, changed: true };
}
