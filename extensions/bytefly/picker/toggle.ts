/**
 * Pure settings-array transforms behind a toggle.
 *
 * Each function takes the current arrays and returns the next ones; no file or
 * host access. The persistence layer (`runtime.ts`) writes the result through
 * a `SettingsStore`. The project variants are a two-state (`+`/`-`) port of
 * `setProjectTopLevelOverride` / `setProjectPackageOverride` from Pi's config
 * selector (`config-selector.js`).
 */

import { join, relative } from "node:path";
import { CONFIG_DIR_NAME, type PackageSource } from "@earendil-works/pi-coding-agent";
import {
	getItemScope,
	getPackageResourcePattern,
	getPatternEntryTarget,
	getResourcePatternForScope,
	getTopLevelBaseDir,
	getTopLevelOverridePatterns,
	isLocalPath,
	resolveLocalSource,
} from "./resources.ts";
import type { ResourceItem } from "./types.ts";

/** Replace any prior pattern for `pattern` and append `+pattern` / `-pattern`. */
export function nextTopLevelList(current: string[], pattern: string, enabled: boolean): string[] {
	const updated = current.filter((entry) => getPatternEntryTarget(entry) !== pattern);
	updated.push(`${enabled ? "+" : "-"}${pattern}`);
	return updated;
}

/**
 * Toggle one extension inside a package entry, converting a string source to
 * object form when needed and collapsing it back when no filters remain.
 * Packages not present in `packages` are returned unchanged.
 */
export function nextGlobalPackages(
	packages: PackageSource[],
	source: string,
	pattern: string,
	enabled: boolean,
): PackageSource[] {
	const updated = [...packages];
	const index = updated.findIndex((entry) => (typeof entry === "string" ? entry : entry.source) === source);
	if (index === -1) return updated;

	let pkg = updated[index];
	if (typeof pkg === "string") {
		pkg = { source: pkg };
		updated[index] = pkg;
	}
	pkg.extensions = nextTopLevelList(pkg.extensions ?? [], pattern, enabled);
	updated[index] = pkg.extensions.length > 0 ? pkg : pkg.source;
	return updated;
}

/** Absolute path of the project `.pi` directory, the base for project patterns. */
function projectBaseDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME);
}

/** A project package entry that filters a personal package instead of replacing it. */
function createProjectPackageSource(item: ResourceItem, cwd: string, agentDir: string): PackageSource {
	const source = item.metadata.source;
	if (!isLocalPath(source)) return { source, autoload: false };
	const absolute = resolveLocalSource(source, getTopLevelBaseDir(getItemScope(item), cwd, agentDir));
	return { source: relative(projectBaseDir(cwd), absolute) || ".", autoload: false };
}

/** Whether a configured source names the same package as `item`, by scope. */
function packageSourceMatches(
	item: ResourceItem,
	source: string,
	targetScope: "user" | "project",
	cwd: string,
	agentDir: string,
): boolean {
	if (source === item.metadata.source) return true;
	if (!isLocalPath(source) || !isLocalPath(item.metadata.source)) return false;
	const left = resolveLocalSource(item.metadata.source, getTopLevelBaseDir(getItemScope(item), cwd, agentDir));
	const right = resolveLocalSource(source, getTopLevelBaseDir(targetScope, cwd, agentDir));
	return left === right;
}

/**
 * Toggle a top-level extension in project settings. An inherited personal
 * resource must be named before it is overridden; a project resource is
 * addressed by its project-relative pattern.
 */
export function nextProjectTopLevelList(
	current: string[],
	item: ResourceItem,
	enabled: boolean,
	cwd: string,
	agentDir: string,
): string[] {
	const inherited = getItemScope(item) === "user";
	const pattern = inherited ? item.path : getResourcePatternForScope(item, "project", cwd, agentDir);
	const patterns = getTopLevelOverridePatterns(item, "project", cwd, agentDir);
	const updated = current.filter((entry) => {
		const isOverride = entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-");
		return !(isOverride && patterns.has(getPatternEntryTarget(entry)));
	});
	if (inherited && item.metadata.source !== "builtin" && !updated.includes(pattern)) updated.push(pattern);
	updated.push(`${enabled ? "+" : "-"}${pattern}`);
	return updated;
}

/**
 * Toggle one extension inside a package in project settings. A missing project
 * entry is created with `autoload: false` so it filters the personal entry
 * rather than replacing it; an entry left with no filters is removed.
 */
export function nextProjectPackages(
	packages: PackageSource[],
	item: ResourceItem,
	enabled: boolean,
	cwd: string,
	agentDir: string,
): PackageSource[] {
	const updated = [...packages];
	let index = updated.findIndex((entry) =>
		packageSourceMatches(item, typeof entry === "string" ? entry : entry.source, "project", cwd, agentDir),
	);
	if (index === -1) {
		updated.push(createProjectPackageSource(item, cwd, agentDir));
		index = updated.length - 1;
	}

	let pkg = updated[index];
	if (typeof pkg === "string") {
		pkg = { source: pkg };
		updated[index] = pkg;
	}
	const pattern = getPackageResourcePattern(item);
	pkg.extensions = nextTopLevelList(pkg.extensions ?? [], pattern, enabled);
	if (pkg.extensions.length > 0) {
		updated[index] = pkg;
	} else if (pkg.autoload === false) {
		updated.splice(index, 1);
	} else {
		updated[index] = pkg.source;
	}
	return updated;
}
