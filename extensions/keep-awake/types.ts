/**
 * Types for the keep-awake extension.
 */

/** Configured default: hold only while the agent works, or for the whole session. */
export type KeepAwakeMode = "auto" | "always";

/** Per-session command override; `undefined` follows the configured mode. */
export type KeepAwakeOverride = "on" | "off";

/** User configuration, loaded from `keep-awake.json`. */
export interface KeepAwakeConfig {
	/** Default behaviour: `auto` (agent runs only) or `always` (whole session). */
	mode: KeepAwakeMode;
	/** Also prevent display sleep/blanking, not just system sleep. */
	keepDisplay: boolean;
}

/** A point-in-time view of the runtime, for the command and the status chip. */
export interface KeepAwakeStatus {
	/** Whether an OS inhibitor is currently held. */
	active: boolean;
	/** Configured default behaviour. */
	mode: KeepAwakeMode;
	/** Per-session override, when set. */
	override?: KeepAwakeOverride;
	/** Host platform. */
	platform: NodeJS.Platform;
	/** Owners currently holding the machine awake through the wake-hold bus. */
	holds: string[];
	/** Why the inhibitor could not start, when it could not. */
	unavailable?: string;
}
