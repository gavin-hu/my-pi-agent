/**
 * Stateful core of the extensions picker, independent of rendering.
 *
 * Owns the active write scope and the live copies of both resource views,
 * computes toggles through the pure `toggle.ts` helpers, and persists them
 * through the scope's `SettingsStore`. The TUI subscribes with `onChange` and
 * reads `items()` on every render, so it stays a derived view of this state.
 */

import { getDisplayName, getPackageResourcePattern, getResourcePattern } from "./resources.ts";
import {
	clearProjectPackages,
	clearProjectTopLevelList,
	nextGlobalPackages,
	nextProjectPackages,
	nextProjectTopLevelList,
	nextTopLevelList,
} from "./toggle.ts";
import type { Discovery, ResourceItem, SettingsStore, WriteScope } from "./types.ts";

export interface RuntimeDeps {
	discovery: Discovery;
	cwd: string;
	agentDir: string;
	onError?: (message: string) => void;
}

export interface ExtensionsPickerRuntime {
	scope(): WriteScope;
	setScope(scope: WriteScope): void;
	items(): ResourceItem[];
	disabledCount(): number;
	projectAvailable(): boolean;
	isDirty(): boolean;
	toggle(item: ResourceItem): Promise<void>;
	/** Drop `item`'s project override in Project scope; a no-op when it has none. */
	clearOverride(item: ResourceItem): Promise<void>;
	onChange(listener: () => void): () => void;
}

/** The store a scope writes through. */
function storeFor(discovery: Discovery, scope: WriteScope): SettingsStore {
	return scope === "global" ? discovery.stores.global : discovery.stores.project;
}

/** Whether two rows name the same resource, for an inherited-state lookup. */
function sameResource(left: ResourceItem, right: ResourceItem): boolean {
	return left.metadata.source === right.metadata.source && left.path === right.path;
}

export function createExtensionsPickerRuntime(deps: RuntimeDeps): ExtensionsPickerRuntime {
	const { discovery, cwd, agentDir } = deps;
	let scope: WriteScope = "global";
	let dirty = false;
	const listeners = new Set<() => void>();
	// Copies so a toggle mutates this runtime's view, not the discovery result.
	const views: Record<WriteScope, ResourceItem[]> = {
		global: discovery.global.map((item) => ({ ...item })),
		project: discovery.effective.map((item) => ({ ...item })),
	};

	const current = (): ResourceItem[] => (scope === "global" ? views.global : views.project);

	const emit = (): void => {
		for (const listener of listeners) listener();
	};

	const persistGlobal = (item: ResourceItem, enabled: boolean): void => {
		const store = storeFor(discovery, "global");
		if (item.metadata.origin === "top-level") {
			const pattern = getResourcePattern(item, cwd, agentDir);
			store.setExtensionPaths(nextTopLevelList(store.globalSettings().extensions ?? [], pattern, enabled));
			return;
		}
		const pattern = getPackageResourcePattern(item);
		store.setPackages(nextGlobalPackages(store.packages(), item.metadata.source, pattern, enabled));
	};

	const persistProject = (item: ResourceItem, enabled: boolean): void => {
		const store = storeFor(discovery, "project");
		if (item.metadata.origin === "top-level") {
			const currentPaths = store.projectSettings().extensions ?? [];
			store.setProjectExtensionPaths(nextProjectTopLevelList(currentPaths, item, enabled, cwd, agentDir));
			return;
		}
		store.setProjectPackages(nextProjectPackages(store.packages(), item, enabled, cwd, agentDir));
	};

	/**
	 * Drop `item`'s project override, reporting whether anything was written. An
	 * absent override returns `false` without touching the store, so a stray key
	 * press cannot dirty the file.
	 */
	const clearFromStore = (item: ResourceItem): boolean => {
		const store = storeFor(discovery, "project");
		if (item.metadata.origin === "top-level") {
			const paths = store.projectSettings().extensions ?? [];
			const next = clearProjectTopLevelList(paths, item, cwd, agentDir);
			if (next === paths) return false;
			store.setProjectExtensionPaths(next);
			return true;
		}
		const packages = store.packages();
		const next = clearProjectPackages(packages, item, cwd, agentDir);
		if (next === packages) return false;
		store.setProjectPackages(next);
		return true;
	};

	return {
		scope: () => scope,
		setScope: (next) => {
			if (next === "project" && !discovery.trusted) return;
			if (next === scope) return;
			scope = next;
			emit();
		},
		items: current,
		disabledCount: () => current().filter((item) => !item.enabled).length,
		projectAvailable: () => discovery.trusted,
		isDirty: () => dirty,
		toggle: async (item) => {
			const enabled = !item.enabled;
			try {
				if (scope === "global") persistGlobal(item, enabled);
				else persistProject(item, enabled);
				const store = storeFor(discovery, scope);
				await store.flush();
				for (const error of store.drainErrors()) deps.onError?.(error.error.message);
			} catch (error) {
				deps.onError?.(error instanceof Error ? error.message : String(error));
				return;
			}
			item.enabled = enabled;
			dirty = true;
			emit();
		},
		clearOverride: async (item) => {
			if (scope !== "project") {
				deps.onError?.("Overrides are cleared in Project scope; switch with Tab.");
				return;
			}
			const store = storeFor(discovery, "project");
			try {
				if (!clearFromStore(item)) {
					deps.onError?.(`No project override for ${getDisplayName(item)}.`);
					return;
				}
				await store.flush();
				for (const error of store.drainErrors()) deps.onError?.(error.error.message);
			} catch (error) {
				deps.onError?.(error instanceof Error ? error.message : String(error));
				return;
			}
			// With the override gone the row shows the inherited state again; a
			// project-only resource has no global twin and keeps its value.
			const inherited = views.global.find((entry) => sameResource(entry, item));
			if (inherited) item.enabled = inherited.enabled;
			dirty = true;
			emit();
		},
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
