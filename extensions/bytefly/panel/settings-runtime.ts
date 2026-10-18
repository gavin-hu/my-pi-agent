/**
 * The stateful Settings section: one snapshot of the two config documents and
 * the personal settings, the dirty flag, and the two write paths.
 *
 * App rows are written through Pi's `SettingsStore` (personal file only), and
 * `bytefly.json` rows through the per-key writer, so an edit cannot disturb a
 * sibling key or another extension's section. A failed write leaves the
 * snapshot untouched and reports through `onError`; the screen never shows a
 * value the file did not accept.
 */

import { join } from "node:path";
import { CONFIG_DIR_NAME, type QuietStartup } from "@earendil-works/pi-coding-agent";
import { readJson, SHARED_CONFIG_FILE, writeConfigValueAt } from "../../../lib/config.ts";
import { CURRENCY_DEFAULTS } from "../footer/price/config.ts";
import type { CurrencyCode } from "../footer/price/types.ts";
import type { SettingsStore, WriteScope } from "../picker/types.ts";
import {
	countSettings,
	nextValue,
	type SettingDescriptor,
	type SettingsSnapshot,
	type SettingView,
	SETTING_ROWS,
	settingViews,
	storedValue,
	textError,
	validValue,
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
	count(scope: WriteScope): number;
	/** Cycle an enum or toggle a boolean. */
	change(scope: WriteScope, id: string): Promise<void>;
	/** Store a value the user typed; `false` when the row refused it. */
	setValue(scope: WriteScope, id: string, raw: string): Promise<boolean>;
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
		global: readJson(join(deps.agentDir, SHARED_CONFIG_FILE)) ?? {},
		project: deps.trusted ? (readJson(join(deps.cwd, CONFIG_DIR_NAME, SHARED_CONFIG_FILE)) ?? {}) : {},
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

/** Create the Settings runtime for one screen invocation. */
export function createSettingsRuntime(deps: SettingsRuntimeDeps): SettingsRuntime {
	let snapshot = readSnapshot(deps);
	let dirty = false;
	const listeners = new Set<() => void>();

	const emit = (): void => {
		for (const listener of listeners) listener();
	};

	return {
		views: (scope) => settingViews(snapshot, scope),
		count: (scope) => countSettings(scope),
		change: async (scope, id) => {
			const row = SETTING_ROWS.find((entry) => entry.id === id);
			if (!row) return;
			if (scope === "project" && !deps.trusted) {
				deps.onError?.("Project is not trusted; settings can only be changed in Global scope.");
				return;
			}
			if (row.source === "app" && scope !== "global") {
				deps.onError?.(`${row.label} is a Global setting.`);
				return;
			}
			const current = settingViews(snapshot, scope).find((entry) => entry.id === id);
			if (!current) return;
			const next = nextValue(row, current.value);
			if (!validValue(row, next.value)) {
				deps.onError?.(`Cannot save ${row.label}: unknown value.`);
				return;
			}

			try {
				if (row.source === "app") {
					applyAppSetting(deps.stores.global, row, next.value);
					await deps.stores.global.flush();
					const errors = deps.stores.global.drainErrors();
					const first = errors[0];
					if (first) throw first.error;
				} else {
					const config = row.config;
					if (!config) throw new Error(`Setting ${row.id} has no config section`);
					const path = configPath(scope, deps.cwd, deps.agentDir);
					writeConfigValueAt(path, config.section, config.path, storedValue(row, next.value));
					if (row.id === "price.currency.code") {
						// Choosing a currency also sets its symbol and precision, so the
						// screen and the footer agree; both remain overridable afterwards.
						const currency = CURRENCY_DEFAULTS[next.value as CurrencyCode];
						writeConfigValueAt(path, "price", ["currency", "symbol"], currency.symbol);
						writeConfigValueAt(path, "price", ["currency", "decimals"], currency.decimals);
					}
				}
			} catch (error) {
				deps.onError?.(`Could not save ${row.label}: ${error instanceof Error ? error.message : String(error)}`);
				return;
			}

			snapshot = readSnapshot(deps);
			dirty = true;
			emit();
		},
		async setValue(scope, id, raw) {
			const row = SETTING_ROWS.find((entry) => entry.id === id);
			if (!row || row.kind !== "text") {
				deps.onError?.(`${row?.label ?? id} cannot be edited as text.`);
				return false;
			}
			if (scope === "project" && !deps.trusted) {
				deps.onError?.("Project is not trusted; settings can only be changed in Global scope.");
				return false;
			}
			if (row.source === "app" && scope !== "global") {
				deps.onError?.(`${row.label} is a Global setting.`);
				return false;
			}
			const refusal = textError(row, raw);
			if (refusal !== undefined) {
				deps.onError?.(refusal);
				return false;
			}

			try {
				const config = row.config;
				if (!config) throw new Error(`Setting ${row.id} has no config section`);
				writeConfigValueAt(configPath(scope, deps.cwd, deps.agentDir), config.section, config.path, raw);
			} catch (error) {
				deps.onError?.(`Could not save ${row.label}: ${error instanceof Error ? error.message : String(error)}`);
				return false;
			}

			snapshot = readSnapshot(deps);
			dirty = true;
			emit();
			return true;
		},
		isDirty: () => dirty,
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
