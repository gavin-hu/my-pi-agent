/**
 * Shared types and host seams for the resource picker.
 *
 * The manager lists and toggles the two resource types the screen offers:
 * extensions and skills. Every host capability it needs is behind a small
 * interface here so the pure logic can be tested without a Pi runtime:
 * `SettingsStore` wraps the settings file, `ResourceResolver` wraps package
 * resolution, and `Discovery` is the pair of views (global and effective) each
 * kind is shown from.
 */

import type { PackageSource, QuietStartup, ResolvedResource, SettingsManager } from "@earendil-works/pi-coding-agent";

/** The merged settings shape Pi writes; not re-exported as a named type. */
export type Settings = ReturnType<SettingsManager["getSettings"]>;

/** Which settings file a toggle is written to. */
export type WriteScope = "global" | "project";

/** One resolved resource and where it came from. */
export type ResourceItem = ResolvedResource;

/** The resource types the picker can list and toggle. */
export type ResourceKind = "extensions" | "skills";

/** Both resource arrays Pi resolves in one pass. */
export interface ResolvedResources {
	extensions: ResourceItem[];
	skills: ResourceItem[];
}

/** A flattened list row: a source-group header or a resource item. */
export type Entry =
	| { kind: "group"; key: string; label: string; count: number }
	| { kind: "item"; key: string; item: ResourceItem; label: string };

/** The settings-file surface the manager reads and writes. */
export interface SettingsStore {
	globalSettings(): Settings;
	projectSettings(): Settings;
	packages(): PackageSource[];
	setExtensionPaths(paths: string[]): void;
	setSkillPaths(paths: string[]): void;
	setPackages(packages: PackageSource[]): void;
	setProjectExtensionPaths(paths: string[]): void;
	setProjectSkillPaths(paths: string[]): void;
	setProjectPackages(packages: PackageSource[]): void;
	/** App preferences are written to the personal settings file. */
	setQuietStartup(quiet: QuietStartup): void;
	setOutputPad(padding: 0 | 1): void;
	setShowHardwareCursor(enabled: boolean): void;
	/** Pi's theme setting is a personal-file preference. */
	setTheme(theme: string): void;
	isProjectTrusted(): boolean;
	flush(): Promise<void>;
	drainErrors(): Array<{ error: Error }>;
}

/** Resolves every configured package into its resource lists. */
export interface ResourceResolver {
	resolve(): Promise<ResolvedResources>;
}

/** One resource kind's two views: personal settings, and what the session sees. */
export interface ResourceViews {
	/** Resources as configured by personal settings only. */
	global: ResourceItem[];
	/** Resources as the session actually sees them (project applied when trusted). */
	effective: ResourceItem[];
}

/** Both settings views plus the stores a toggle writes through. */
export interface Discovery {
	extensions: ResourceViews;
	skills: ResourceViews;
	stores: { global: SettingsStore; project: SettingsStore };
	/** Whether the project settings file may be read and written. */
	trusted: boolean;
}
