/**
 * Pure resource helpers: grouping, labels, display names, and the settings
 * pattern arithmetic the toggle layer needs.
 *
 * The pattern functions are a trimmed port of Pi's own config selector
 * (`dist/modes/interactive/components/config-selector.js`) restricted to the
 * `extensions` resource type. Keeping them here, pure and separately tested,
 * makes a future drift from the built-in easy to diff.
 */

import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME, type PathMetadata } from "@earendil-works/pi-coding-agent";
import type { Entry, ResourceItem } from "./types.ts";

/** Settings scope of a single resource, in the config selector's vocabulary. */
type ItemScope = "user" | "project";

/** User settings resolve from the agent directory; project settings from `.pi`. */
export function getTopLevelBaseDir(scope: ItemScope, cwd: string, agentDir: string): string {
	return scope === "project" ? join(cwd, CONFIG_DIR_NAME) : agentDir;
}

/** A resource's settings scope (`temporary` resources count as user-level). */
export function getItemScope(item: ResourceItem): ItemScope {
	return item.metadata.scope === "project" ? "project" : "user";
}

/** Strip the `!` / `+` / `-` modifier from a settings pattern entry. */
export function getPatternEntryTarget(entry: string): string {
	return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-") ? entry.slice(1) : entry;
}

/** Pattern naming a top-level resource relative to its settings base directory. */
export function getResourcePattern(item: ResourceItem, cwd: string, agentDir: string): string {
	if (item.metadata.source === "builtin") return item.path;
	const scope = getItemScope(item);
	const baseDir = item.metadata.baseDir ?? getTopLevelBaseDir(scope, cwd, agentDir);
	return relative(baseDir, item.path);
}

/** Pattern naming a package resource relative to the package root. */
export function getPackageResourcePattern(item: ResourceItem): string {
	const baseDir = item.metadata.baseDir ?? dirname(item.path);
	return relative(baseDir, item.path);
}

/** `getResourcePattern`, but relative to the scope a project override writes to. */
export function getResourcePatternForScope(
	item: ResourceItem,
	scope: ItemScope,
	cwd: string,
	agentDir: string,
): string {
	const sourceScope = getItemScope(item);
	if (scope !== sourceScope || item.metadata.source === "builtin") return item.path;
	const baseDir = item.metadata.baseDir ?? getTopLevelBaseDir(sourceScope, cwd, agentDir);
	return relative(baseDir, item.path);
}

/** Every pattern that could name `item` in a project top-level override. */
export function getTopLevelOverridePatterns(
	item: ResourceItem,
	scope: ItemScope,
	cwd: string,
	agentDir: string,
): Set<string> {
	const baseDir = getTopLevelBaseDir(scope, cwd, agentDir);
	const patterns = new Set([
		getResourcePatternForScope(item, scope, cwd, agentDir),
		item.path,
		relative(baseDir, item.path),
	]);
	if (item.metadata.baseDir) patterns.add(relative(item.metadata.baseDir, item.path));
	return patterns;
}

/** Whether a package source string is a filesystem path rather than npm/git. */
export function isLocalPath(source: string): boolean {
	return source.startsWith(".") || source.startsWith("/") || source.startsWith("~") || /^[A-Za-z]:[\\/]/.test(source);
}

/** Absolute path of a local package source, relative to its settings scope. */
export function resolveLocalSource(source: string, baseDir: string): string {
	const expanded = source.startsWith("~") ? join(homedir(), source.slice(1)) : source;
	return resolve(baseDir, expanded);
}

/** Display path for a group header: the home directory becomes `~`. */
function formatBaseDir(baseDir: string): string {
	const home = homedir();
	const display =
		baseDir === home
			? "~"
			: baseDir.startsWith(home)
				? `~${baseDir.slice(home.length).replaceAll("\\", "/")}`
				: baseDir.replaceAll("\\", "/");
	return display.endsWith("/") ? display : `${display}/`;
}

/** Header label for a source group, mirroring Pi's config selector. */
export function getGroupLabel(metadata: PathMetadata, agentDir: string): string {
	if (metadata.origin === "package") return `${metadata.source} (${metadata.scope})`;
	if (metadata.source === "builtin") {
		return metadata.scope === "user" ? "Built-in" : "Built-in (project override)";
	}
	if (metadata.source === "auto") {
		if (metadata.baseDir) {
			return metadata.scope === "user"
				? `User (${formatBaseDir(metadata.baseDir)})`
				: `Project (${formatBaseDir(metadata.baseDir)})`;
		}
		return metadata.scope === "user" ? `User (${formatBaseDir(agentDir)})` : `Project (${CONFIG_DIR_NAME}/)`;
	}
	return metadata.scope === "user" ? "User settings" : "Project settings";
}

/** Short name for one extension: `folder/file.ts` when it sits in a subfolder. */
export function getDisplayName(item: ResourceItem): string {
	const fileName = basename(item.path);
	const parentFolder = basename(dirname(item.path));
	if (item.metadata.source === "builtin") return fileName;
	return parentFolder === "extensions" ? fileName : `${parentFolder}/${fileName}`;
}

/** Stable identity for a resource row, used to keep the cursor across renders. */
export function itemKey(item: ResourceItem): string {
	return `${item.metadata.source}:${item.path}`;
}

/** A source group the flat list is built from. */
interface Group {
	key: string;
	label: string;
	origin: PathMetadata["origin"];
	scope: PathMetadata["scope"];
	source: string;
	items: ResourceItem[];
}

/**
 * Flatten resources into group headers and item rows, sorted packages-first,
 * then user-before-project, then by source; items sort by display name.
 */
export function buildEntries(items: ResourceItem[], agentDir: string): Entry[] {
	const groups = new Map<string, Group>();
	for (const item of items) {
		const { metadata } = item;
		const key = `${metadata.origin}:${metadata.scope}:${metadata.source}:${metadata.baseDir ?? ""}`;
		let group = groups.get(key);
		if (!group) {
			group = {
				key,
				label: getGroupLabel(metadata, agentDir),
				origin: metadata.origin,
				scope: metadata.scope,
				source: metadata.source,
				items: [],
			};
			groups.set(key, group);
		}
		group.items.push(item);
	}

	const sorted = [...groups.values()].sort((a, b) => {
		if (a.origin !== b.origin) return a.origin === "package" ? -1 : 1;
		if (a.scope !== b.scope) return a.scope === "user" ? -1 : 1;
		return a.source.localeCompare(b.source);
	});

	const entries: Entry[] = [];
	for (const group of sorted) {
		const items = [...group.items].sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b)));
		entries.push({ kind: "group", key: group.key, label: group.label, count: items.length });
		for (const item of items) entries.push({ kind: "item", key: itemKey(item), item, label: getDisplayName(item) });
	}
	return entries;
}

/**
 * The next item row from `from` in `direction`, skipping group headers.
 * Returns `undefined` when there is no further item.
 */
export function nextSelectable(entries: Entry[], from: number, direction: -1 | 1): number | undefined {
	for (let index = from + direction; index >= 0 && index < entries.length; index += direction) {
		if (entries[index].kind === "item") return index;
	}
	return undefined;
}

/** The first item row at or after `from`, or `undefined` when there is none. */
export function firstSelectable(entries: Entry[], from = 0): number | undefined {
	for (let index = Math.max(0, from); index < entries.length; index++) {
		if (entries[index].kind === "item") return index;
	}
	return undefined;
}

/** Plain-text listing used outside TUI mode. */
export function formatListing(items: ResourceItem[], agentDir: string): string {
	if (items.length === 0) return "No extensions found.";
	const lines: string[] = [];
	for (const entry of buildEntries(items, agentDir)) {
		if (entry.kind === "group") lines.push(`${entry.label} (${entry.count})`);
		else lines.push(`  [${entry.item.enabled ? "x" : " "}] ${entry.label}`);
	}
	return lines.join("\n");
}
