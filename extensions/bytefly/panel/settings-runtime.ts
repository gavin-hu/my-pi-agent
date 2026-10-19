/**
 * The stateful Settings section: one snapshot of the two config documents and
 * the personal settings, the dirty flag, and the writes it offers.
 *
 * App rows are written through Pi's `SettingsStore` (personal file only), and
 * `bytefly.json` rows through the per-key writers, so an edit cannot disturb a
 * sibling key or another extension's section. A reset deletes one leaf through the
 * same path, and the JSON pane reads the section the row belongs to. A failed
 * write leaves the snapshot untouched and reports through `onError`; the screen
 * never shows a value the file did not accept.
 */

import { join } from "node:path";
import { CONFIG_DIR_NAME, type QuietStartup } from "@earendil-works/pi-coding-agent";
import {
	configSection,
	configValueAt,
	readJson,
	SHARED_CONFIG_FILE,
	unsetConfigValueAt,
	writeConfigValueAt,
} from "../../../lib/config.ts";
import type { SettingsStore, WriteScope } from "../picker/types.ts";
import {
	type ConfigSectionName,
	nextValue,
	type SettingDescriptor,
	type SettingsSnapshot,
	type SettingView,
	SETTING_ROWS,
	settingViews,
	storedValue,
	textError,
} from "./settings.ts";

/** Host seams for the Settings runtime. */
export interface SettingsRuntimeDeps {
	/** The personal store, and the project store when the project is trusted. */
	stores: { global: SettingsStore; project: SettingsStore };
	cwd: string;
	agentDir: string;
	trusted: boolean;
	/** Report a refused or failed write to the screen. */
	onError?: (message: string) => void;
}

/** What the panel needs from the runtime. */
export interface SettingsSurface {
	views(scope: WriteScope): SettingView[];
	/** Cycle an enum or toggle a boolean. */
	change(scope: WriteScope, id: string): Promise<void>;
	/** Store a value the user typed; `false` when the row refused it. */
	setValue(scope: WriteScope, id: string, raw: string): Promise<boolean>;
	/** Delete the focused row's leaf so its default applies; `false` when nothing changed. */
	reset(scope: WriteScope, id: string): Promise<boolean>;
	/** The raw `bytefly.json` section for `scope`, for the JSON pane. */
	sectionDocument(scope: WriteScope, section: ConfigSectionName): unknown;
	isDirty(): boolean;
}

/** A {@link SettingsSurface} that also notifies the screen after a change. */
export interface SettingsRuntime extends SettingsSurface {
	onChange(listener: () => void): () => void;
}

/** The shared document for a write scope. */
export function configPath(scope: WriteScope, cwd: string, agentDir: string): string {
	return scope === "global" ? join(agentDir, SHARED_CONFIG_FILE) : join(cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE);
}

/** Read the current personal settings and both config documents. */
function readSnapshot(deps: SettingsRuntimeDeps): SettingsSnapshot {
	return {
		app: deps.stores.global.globalSettings(),
		global: readJson(configPath("global", deps.cwd, deps.agentDir)) ?? {},
		project: deps.trusted ? (readJson(configPath("project", deps.cwd, deps.agentDir)) ?? {}) : {},
	};
}

/** Apply one app row through the typed Pi setter. */
function applyAppSetting(store: SettingsStore, row: SettingDescriptor, raw: string): void {
	const value = storedValue(row, raw);
	switch (row.id) {
		case "byteflyUi":
			store.setQuietStartup(value as QuietStartup);
			return;
		case "outputPad":
			store.setOutputPad(value as 0 | 1);
			return;
		case "showHardwareCursor":
			store.setShowHardwareCursor(value as boolean);
			return;
		default:
			throw new Error(`Unknown app setting ${row.id}`);
	}
}

/** Why `row` cannot be written in `scope`, or `undefined` when it can. */
function refusal(row: SettingDescriptor, scope: WriteScope, trusted: boolean): string | undefined {
	if (scope === "project" && !trusted) {
		return "Project is not trusted; settings can only be changed in Global scope.";
	}
	if (row.source === "app" && scope !== "global") return `${row.label} is a Global setting.`;
	return undefined;
}

/** Create the Settings runtime for one screen invocation. */
export function createSettingsRuntime(deps: SettingsRuntimeDeps): SettingsRuntime {
	let snapshot = readSnapshot(deps);
	let dirty = false;
	const listeners = new Set<() => void>();

	const emit = (): void => {
		for (const listener of listeners) listener();
	};

	/**
	 * Write one row's value, including the extra leaves the row declares. Throws
	 * with the reason a write failed; the caller formats it and leaves the
	 * displayed value alone.
	 */
	const write = async (scope: WriteScope, row: SettingDescriptor, raw: string): Promise<void> => {
		if (row.source === "app") {
			applyAppSetting(deps.stores.global, row, raw);
			await deps.stores.global.flush();
			const first = deps.stores.global.drainErrors()[0];
			if (first) throw first.error;
			return;
		}
		const config = row.config;
		if (!config) throw new Error(`Setting ${row.id} has no config section`);
		const path = configPath(scope, deps.cwd, deps.agentDir);
		writeConfigValueAt(path, config.section, config.path, storedValue(row, raw));
		for (const leaf of row.also?.(raw) ?? []) writeConfigValueAt(path, leaf.section, leaf.path, leaf.value);
	};

	/** Take a completed write: re-read the snapshot, mark it dirty, repaint. */
	const committed = (): void => {
		snapshot = readSnapshot(deps);
		dirty = true;
		emit();
	};

	return {
		views: (scope) => settingViews(snapshot, scope),
		change: async (scope, id) => {
			const row = SETTING_ROWS.find((entry) => entry.id === id);
			if (!row) return;
			// Only a boolean or an enum cycles; a text row is stored from its editor,
			// so refusing here keeps `nextValue`'s cycle contract honest.
			if (row.kind === "text") {
				deps.onError?.(`${row.label} is edited as text, not cycled.`);
				return;
			}
			const refused = refusal(row, scope, deps.trusted);
			if (refused !== undefined) {
				deps.onError?.(refused);
				return;
			}
			const current = settingViews(snapshot, scope).find((entry) => entry.id === id);
			if (!current) return;
			const next = nextValue(row, current.value);
			try {
				await write(scope, row, next.value);
			} catch (error) {
				deps.onError?.(`Could not save ${row.label}: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}
			committed();
		},
		async setValue(scope, id, raw) {
			const row = SETTING_ROWS.find((entry) => entry.id === id);
			if (!row) {
				deps.onError?.(`${id} is not a setting.`);
				return false;
			}
			const refused = refusal(row, scope, deps.trusted);
			if (refused !== undefined) {
				deps.onError?.(refused);
				return false;
			}
			const invalid = textError(row, raw);
			if (invalid !== undefined) {
				deps.onError?.(invalid);
				return false;
			}
			try {
				await write(scope, row, raw);
			} catch (error) {
				deps.onError?.(`Could not save ${row.label}: ${error instanceof Error ? error.message : String(error)}`);
				return false;
			}
			committed();
			return true;
		},
		async reset(scope, id) {
			const row = SETTING_ROWS.find((entry) => entry.id === id);
			if (!row) {
				deps.onError?.(`${id} is not a setting.`);
				return false;
			}
			if (row.source === "app") {
				deps.onError?.(`${row.label} is a Pi setting; Pi has no unset, so set the value instead.`);
				return false;
			}
			const refused = refusal(row, scope, deps.trusted);
			if (refused !== undefined) {
				deps.onError?.(refused);
				return false;
			}
			const config = row.config;
			if (!config) return false;
			const document = scope === "global" ? snapshot.global : snapshot.project;
			if (configValueAt(configSection(document, config.section), config.path) === undefined) {
				deps.onError?.(`${row.label} is already at its default.`);
				return false;
			}
			try {
				unsetConfigValueAt(configPath(scope, deps.cwd, deps.agentDir), config.section, config.path);
			} catch (error) {
				deps.onError?.(`Could not reset ${row.label}: ${error instanceof Error ? error.message : String(error)}`);
				return false;
			}
			committed();
			return true;
		},
		sectionDocument: (scope, section) =>
			configSection(scope === "global" ? snapshot.global : snapshot.project, section),
		isDirty: () => dirty,
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
