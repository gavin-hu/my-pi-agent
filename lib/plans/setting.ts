/**
 * The switch that lets a plan be approved as a team, and the words the user flips
 * it with.
 *
 * It lives in `lib/` because three places must agree: the settings row that
 * writes it, plan approval that reads it, and the bus that refuses a join while
 * it is off. A second copy of the key would mean a panel row that changes
 * nothing — the failure this module exists to prevent.
 *
 * Off by default: a team changes what approval means and adds work nobody asked
 * for, so it ships closed and an existing user upgrades into the single flow they
 * already know.
 */

import { asBoolean, configValueAt, loadConfigSection } from "../config.ts";

/** The shared document's section and key that hold the switch. */
export const TEAM_SECTION = "plan";
export const TEAM_KEY = "team";
export const TEAM_DEFAULT = false;

/** The settings-panel row, so a refusal can name what the user flips. */
export const TEAM_SETTING_ID = "plan.team";
export const TEAM_SETTING_LABEL = "Run plans as a team";

/** The section's shape and its default, so a loader and its documentation agree. */
export interface TeamConfig {
	team: boolean;
}

export const DEFAULT_TEAM_CONFIG: TeamConfig = { team: TEAM_DEFAULT };

/** Read the section over `base`, ignoring a value that is not a boolean. */
export function normalizeTeamConfig(raw: Record<string, unknown> | undefined, base: TeamConfig): TeamConfig {
	return { team: asBoolean(configValueAt(raw, [TEAM_KEY]), base.team) };
}

/**
 * Whether this repository (or the user's global config) lets a plan run as a team.
 *
 * The project file is read at `root` when the caller knows it: a team belongs to
 * the repository, so a session started in a subdirectory must honour what the
 * repository turned on. Without a root the session's cwd is used, which is what a
 * caller outside a repository has.
 */
export function teamEnabled(cwd: string, root?: string): boolean {
	return loadConfigSection(root ?? cwd, TEAM_SECTION, DEFAULT_TEAM_CONFIG, normalizeTeamConfig).team;
}

/** The one line a refusal or a note uses to say the switch is off and where it lives. */
export const TEAM_OFF_NOTE =
	`Running a plan as a team is off (${TEAM_SETTING_ID}). ` +
	`Enable "${TEAM_SETTING_LABEL}" in /bytefly settings to approve a plan with units.`;
