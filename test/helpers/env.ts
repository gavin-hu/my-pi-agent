/**
 * Shared temp-directory and environment helpers.
 *
 * `withAgentDir` wraps the save/restore pattern for `PI_CODING_AGENT_DIR` so
 * tests cannot leak the variable between runs, and `ALL_EXTENSIONS_ENV` is the
 * environment that loads the whole pack.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENV_DISABLED_EXTENSIONS, ENV_ENABLED_EXTENSIONS, OPT_IN_EXTENSIONS } from "../../lib/env.ts";

/**
 * The environment a session needs to load every extension the manifest
 * declares: nothing disabled, and every opt-in extension named. A harness that
 * registers every factory applies this rather than naming the opt-in extensions
 * itself, so a second one needs no harness edit — and a surface that silently
 * came back empty cannot pass a doc guard.
 */
export const ALL_EXTENSIONS_ENV: Record<string, string> = {
	[ENV_DISABLED_EXTENSIONS]: "",
	[ENV_ENABLED_EXTENSIONS]: [...OPT_IN_EXTENSIONS].join(","),
};

/** A fresh temp directory under the OS temp root. */
export function tempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

/** Point `PI_CODING_AGENT_DIR` at a temp dir, returning a restore callback. */
export function useAgentDir(prefix = "pi-agent-"): { dir: string; restore: () => void } {
	const original = process.env.PI_CODING_AGENT_DIR;
	const dir = tempDir(prefix);
	process.env.PI_CODING_AGENT_DIR = dir;
	return {
		dir,
		restore: () => {
			if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = original;
		},
	};
}

/** Run `fn` with `PI_CODING_AGENT_DIR` pointed at a temp dir, always restoring. */
export async function withAgentDir<T>(fn: (dir: string) => Promise<T> | T, prefix = "pi-agent-"): Promise<T> {
	const { dir, restore } = useAgentDir(prefix);
	try {
		return await fn(dir);
	} finally {
		restore();
	}
}

/**
 * Set environment variables for a block, restoring the previous values after.
 * A `undefined` value deletes the variable. Use this instead of writing to
 * `process.env` in a test; the `test/structure.test.ts` scan rejects direct
 * writes.
 */
export function useEnv(vars: Record<string, string | undefined>): { restore: () => void } {
	const saved = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(vars)) {
		saved.set(key, process.env[key]);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return {
		restore: () => {
			for (const [key, value] of saved) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		},
	};
}

/** Run `fn` with `vars` applied, always restoring the previous environment. */
export async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
	const { restore } = useEnv(vars);
	try {
		return await fn();
	} finally {
		restore();
	}
}
