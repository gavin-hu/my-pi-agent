/**
 * Fixture for bytefly's settings suite.
 *
 * The settings doubles bytefly's panel reads: the snapshot over the three
 * documents, the row and view lookups, the `bytefly.json` document that states
 * one row's leaf, and the surface and runtime doubles a component or the
 * `/bytefly` command drives — all over an in-memory snapshot, so a settings
 * test writes nothing to the agent directory.
 *
 * Value-only: every surface and snapshot is created per call.
 */

import type { Settings, WriteScope } from "../../../extensions/bytefly/picker/types.ts";
import {
	nextValue,
	SETTING_ROWS,
	type SettingDescriptor,
	type SettingsSnapshot,
	settingViews,
	storedValue,
} from "../../../extensions/bytefly/panel/settings.ts";
import type { SettingsRuntime, SettingsSurface } from "../../../extensions/bytefly/panel/settings-runtime.ts";
import { withLeaf } from "../config.ts";

export function settingsSnapshot(overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
	return {
		app: overrides.app ?? {},
		global: overrides.global ?? {},
		project: overrides.project ?? {},
		themes: overrides.themes ?? [],
	};
}

export function settingDescriptor(id: string): SettingDescriptor {
	const found = SETTING_ROWS.find((entry) => entry.id === id);
	if (!found) throw new Error(`missing row ${id}`);
	return found;
}

export function settingView(snap: SettingsSnapshot, scope: WriteScope, id: string) {
	const found = settingViews(snap, scope).find((entry) => entry.id === id);
	if (!found) throw new Error(`missing view ${id}`);
	return found;
}

/** The `bytefly.json` document that states one row's leaf, for a read test. */
export function documentFor(row: SettingDescriptor, value: unknown): Record<string, unknown> {
	const config = row.config;
	if (!config) return {};
	let patch: unknown = value;
	for (const key of [...config.path].reverse()) patch = { [key]: patch };
	return { [config.section]: patch };
}

/** A copy of `source` without the leaf at `path`; the unset writer's inverse, in memory. */
function withoutLeaf(source: Record<string, unknown>, path: readonly string[]): Record<string, unknown> | undefined {
	const [head, ...rest] = path;
	if (head === undefined) return source;
	const next = { ...source };
	if (rest.length === 0) {
		delete next[head];
	} else {
		const child = source[head] as Record<string, unknown> | undefined;
		if (!child || typeof child !== "object") return source;
		const pruned = withoutLeaf(child, rest);
		if (pruned === undefined) delete next[head];
		else next[head] = pruned;
	}
	return Object.keys(next).length === 0 ? undefined : next;
}

/** A settings surface over an in-memory snapshot, for rendering and interaction. */
export function fakeSettingsSurface(
	options: {
		app?: Settings;
		global?: Record<string, unknown>;
		project?: Record<string, unknown>;
		themes?: readonly string[];
	} = {},
) {
	const state: SettingsSnapshot = {
		app: options.app ?? {},
		global: options.global ?? {},
		project: options.project ?? {},
		themes: options.themes ?? [],
	};
	const changes: string[] = [];
	let dirty = false;
	const surface: SettingsSurface = {
		views: (scope) => settingViews(state, scope),
		setValue: async (scope, id, raw) => {
			const view = settingViews(state, scope).find((entry) => entry.id === id);
			if (!view?.config) return false;
			const document = scope === "global" ? state.global : state.project;
			const section = (document[view.config.section] ?? {}) as Record<string, unknown>;
			document[view.config.section] = withLeaf(section, view.config.path, raw);
			dirty = true;
			changes.push(`${scope}:${id}=${raw}`);
			return true;
		},
		change: async (scope, id) => {
			const view = settingViews(state, scope).find((entry) => entry.id === id);
			if (!view) return;
			const next = nextValue(view, view.value);
			const config = view.config;
			if (view.source === "app") {
				const app = state.app as unknown as Record<string, unknown>;
				const key = id === "byteflyUi" ? "quietStartup" : id;
				app[key] = storedValue(view, next.value);
			} else if (config) {
				const document = scope === "global" ? state.global : state.project;
				const section = (document[config.section] ?? {}) as Record<string, unknown>;
				document[config.section] = withLeaf(section, config.path, storedValue(view, next.value));
			}
			dirty = true;
			changes.push(`${scope}:${id}`);
		},
		reset: async (scope, id) => {
			const view = settingViews(state, scope).find((entry) => entry.id === id);
			const config = view?.config;
			if (!config) return false;
			const document = scope === "global" ? state.global : state.project;
			const section = document[config.section] as Record<string, unknown> | undefined;
			if (!section || typeof section !== "object") return false;
			const next = withoutLeaf(section, config.path);
			if (next === undefined) delete document[config.section];
			else document[config.section] = next;
			dirty = true;
			changes.push(`${scope}:${id}=reset`);
			return true;
		},
		sectionDocument: (scope, section) => (scope === "global" ? state.global : state.project)[section],
		isDirty: () => dirty,
	};
	return { surface, changes, snapshot: state, isDirty: () => dirty };
}

/** A Settings runtime double over an in-memory snapshot. */
export function fakeSettings(options: { dirty?: boolean; snapshot?: SettingsSnapshot } = {}): SettingsRuntime {
	const state = options.snapshot ?? settingsSnapshot();
	let dirty = options.dirty ?? false;
	return {
		views: (scope) => settingViews(state, scope),
		change: async () => {
			dirty = true;
		},
		setValue: async () => {
			dirty = true;
			return true;
		},
		reset: async () => {
			dirty = true;
			return true;
		},
		sectionDocument: () => undefined,
		isDirty: () => dirty,
		onChange: () => () => {},
	};
}
