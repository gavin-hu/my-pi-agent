/**
 * Session-scoped state for the prompt extension.
 *
 * The factory creates one runtime per extension load. Config is replaced at
 * `session_start`, which also clears any `/prompt refine on|off` override so a
 * new session follows the file again. The busy guard keeps a rapid second submit
 * from starting a second refinement while the first is still open.
 */

import { DEFAULT_PROMPT_CONFIG, type PromptConfig } from "./config.ts";

export interface PromptRuntime {
	/** The config in effect this session. */
	getConfig(): PromptConfig;
	/** Replace the config; clears the session on/off override. */
	setConfig(config: PromptConfig): void;
	/** Effective on/off state (session override, else the config file). */
	isEnabled(): boolean;
	/** Set the session-only override. */
	setEnabled(enabled: boolean): void;
	/** True while a refinement is in flight. */
	isBusy(): boolean;
	/** Claim the in-flight slot; `false` when it is already taken. */
	begin(): boolean;
	/** Release the in-flight slot. */
	end(): void;
}

export function createPromptRuntime(): PromptRuntime {
	let config: PromptConfig = DEFAULT_PROMPT_CONFIG;
	// `undefined` means "follow the config file"; a boolean is the session override.
	let override: boolean | undefined;
	let busy = false;

	return {
		getConfig: () => config,
		setConfig: (next) => {
			config = next;
			override = undefined;
		},
		isEnabled: () => override ?? config.enabled,
		setEnabled: (enabled) => {
			override = enabled;
		},
		isBusy: () => busy,
		begin: () => {
			if (busy) return false;
			busy = true;
			return true;
		},
		end: () => {
			busy = false;
		},
	};
}
