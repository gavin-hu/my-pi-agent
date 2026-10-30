/**
 * The worktree extension publishes its effective root through the process
 * environment so peer and child code follows the isolated worktree. Pi loads
 * each extension with an isolated module cache and extensions cannot import one
 * another, so the variable name and the "is it still on disk?" check live here.
 */

import { existsSync } from "node:fs";

/** Env var holding the active worktree path, set by the worktree extension. */
export const ENV_ROOT = "PI_WORKTREE_ROOT";

/**
 * Env var listing extension names to skip. Entries are separated by commas
 * and/or whitespace. Unset or empty means every extension loads except the
 * opt-in ones.
 */
export const ENV_DISABLED_EXTENSIONS = "PI_DISABLED_EXTENSIONS";

/**
 * Env var listing the opt-in extensions to load. Entries are separated by
 * commas and/or whitespace. Only `OPT_IN_EXTENSIONS` reads it; it never
 * switches off an extension that loads by default.
 */
export const ENV_ENABLED_EXTENSIONS = "PI_ENABLED_EXTENSIONS";

/** Env var that turns off Pi's automatic network activity, including our own. */
export const ENV_OFFLINE = "PI_OFFLINE";

/**
 * Extensions that stay unloaded unless `PI_ENABLED_EXTENSIONS` names them.
 *
 * They are declared in the package manifest like every other extension, so Pi
 * still discovers them and their docs stay in the pack; the surface is simply
 * not registered until the session asks for it. `new Set` rather than an array
 * literal because `test/structure.test.ts` rejects a module-level array in
 * `lib/`, and a fixed keyword table is the one container that rule allows.
 */
export const OPT_IN_EXTENSIONS: ReadonlySet<string> = new Set(["board"]);

/** What the environment says about one extension this session. */
export type ExtensionEnablement = "on" | "disabled" | "opt-in";

/** The names in an extension-list variable, lowercased; empty when it is unset. */
function listedExtensions(variable: string): Set<string> {
	const raw = process.env[variable];
	if (!raw) return new Set();
	return new Set(
		raw
			.split(/[\s,]+/)
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean),
	);
}

/**
 * How this session treats `name`: `disabled` when `PI_DISABLED_EXTENSIONS`
 * names it, `opt-in` when only `PI_ENABLED_EXTENSIONS` can switch it on and has
 * not, and `on` otherwise. An explicit disable wins over an opt-in name.
 */
export function extensionEnablement(name: string): ExtensionEnablement {
	const key = name.toLowerCase();
	if (listedExtensions(ENV_DISABLED_EXTENSIONS).has(key)) return "disabled";
	if (OPT_IN_EXTENSIONS.has(key) && !listedExtensions(ENV_ENABLED_EXTENSIONS).has(key)) return "opt-in";
	return "on";
}

/** Whether `name` loads this session, i.e. {@link extensionEnablement} says `on`. */
export function isExtensionEnabled(name: string): boolean {
	return extensionEnablement(name) === "on";
}

/**
 * What a report says about `name`: why this session is not loading it, or
 * undefined when it is. One call answers both, so the state and the sentence
 * cannot disagree, and the switch it names is the one that would change it.
 */
export function extensionDisabledReason(name: string): string | undefined {
	switch (extensionEnablement(name)) {
		case "on":
			return undefined;
		case "opt-in":
			return `an opt-in extension; load it with \`${ENV_ENABLED_EXTENSIONS}=${name.toLowerCase()}\``;
		case "disabled":
			return `disabled through \`${ENV_DISABLED_EXTENSIONS}\``;
	}
}

/**
 * Whether `PI_OFFLINE` is on, read the way Pi reads it: `1`, `true`, or `yes`
 * (case-insensitive). Any other value, including empty, is off.
 */
export function isOffline(): boolean {
	const raw = process.env[ENV_OFFLINE]?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}

/** The active worktree root from the environment, when set and still on disk. */
export function worktreeRoot(): string | undefined {
	const root = process.env[ENV_ROOT];
	return root && existsSync(root) ? root : undefined;
}

/** `cwd`, or the active worktree root when this session is isolated. */
export function resolveEffectiveCwd(cwd: string): string {
	return worktreeRoot() ?? cwd;
}
