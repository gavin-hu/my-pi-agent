/**
 * Shared types and host seams for the extensions manager.
 *
 * The manager only lists and toggles the `extensions` resource type. Every
 * host capability it needs is behind a small interface here so the pure logic
 * can be tested without a Pi runtime: `SettingsStore` wraps the settings file,
 * `ExtensionResolver` wraps package resolution, and `Discovery` is the pair of
 * views (global and effective) the screen shows.
 */

import type { PackageSource, ResolvedResource, SettingsManager } from "@earendil-works/pi-coding-agent";

/** The merged settings shape Pi writes; not re-exported as a named type. */
export type Settings = ReturnType<SettingsManager["getSettings"]>;

/** Which settings file a toggle is written to. */
export type WriteScope = "global" | "project";

/** One resolved extension and where it came from. */
export type ResourceItem = ResolvedResource;

/** A flattened list row: a source-group header or an extension item. */
export type Entry =
	| { kind: "group"; key: string; label: string; count: number }
	| { kind: "item"; key: string; item: ResourceItem; label: string };

/** The settings-file surface the manager reads and writes. */
export interface SettingsStore {
	globalSettings(): Settings;
	projectSettings(): Settings;
	packages(): PackageSource[];
	setExtensionPaths(paths: string[]): void;
	setPackages(packages: PackageSource[]): void;
	setProjectExtensionPaths(paths: string[]): void;
	setProjectPackages(packages: PackageSource[]): void;
	isProjectTrusted(): boolean;
	flush(): Promise<void>;
	drainErrors(): Array<{ error: Error }>;
}

/** Resolves every configured package into its extension resources. */
export interface ExtensionResolver {
	resolve(): Promise<ResolvedResource[]>;
}

/** Both settings views plus the stores a toggle writes through. */
export interface Discovery {
	/** Resources as configured by personal settings only. */
	global: ResourceItem[];
	/** Resources as the session actually sees them (project applied when trusted). */
	effective: ResourceItem[];
	stores: { global: SettingsStore; project: SettingsStore };
	/** Whether the project settings file may be read and written. */
	trusted: boolean;
}
