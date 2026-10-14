/**
 * Behaviour config for the memory extension.
 *
 * The `memory` section of the shared `bytefly.json` (global then project,
 * project wins). The stored
 * notes are markdown, not JSON — only recall behavior is configured here.
 */

import { clampInteger, loadConfigSection } from "../../lib/config.ts";

export interface MemoryConfig {
	/** Inject stored notes before each run. */
	inject: boolean;
	/** Largest injected body, in UTF-8 bytes. */
	maxInjectBytes: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = { inject: true, maxInjectBytes: 8192 };

const MIN_INJECT_BYTES = 512;
const MAX_INJECT_BYTES = 32768;

/** Validate a raw config object over `base`. */
export function normalizeMemoryConfig(raw: Record<string, unknown> | undefined, base: MemoryConfig): MemoryConfig {
	if (!raw) return base;
	return {
		inject: typeof raw.inject === "boolean" ? raw.inject : base.inject,
		maxInjectBytes: clampInteger(raw.maxInjectBytes, base.maxInjectBytes, MIN_INJECT_BYTES, MAX_INJECT_BYTES),
	};
}

/** Effective memory config from the shared `memory` section (defaults, global, project, env). */
export function loadMemoryConfig(cwd: string): MemoryConfig {
	return loadConfigSection(cwd, "memory", DEFAULT_MEMORY_CONFIG, normalizeMemoryConfig);
}
