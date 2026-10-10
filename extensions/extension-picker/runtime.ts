/**
 * Stateful core of the extensions manager, independent of rendering.
 *
 * Owns the active write scope and the live copies of both resource views,
 * computes toggles through the pure `toggle.ts` helpers, and persists them
 * through the scope's `SettingsStore`. The TUI subscribes with `onChange` and
 * reads `items()` on every render, so it stays a derived view of this state.
 */

import { getPackageResourcePattern, getResourcePattern } from "./resources.ts";
import { nextGlobalPackages, nextProjectPackages, nextProjectTopLevelList, nextTopLevelList } from "./toggle.ts";
import type { Discovery, ResourceItem, SettingsStore, WriteScope } from "./types.ts";

export interface RuntimeDeps {
	discovery: Discovery;
	cwd: string;
	agentDir: string;
	onError?: (message: string) => void;
}

export interface ExtensionsManagerRuntime {
	scope(): WriteScope;
	setScope(scope: WriteScope): void;
	items(): ResourceItem[];
	disabledCount(): number;
	projectAvailable(): boolean;
	isDirty(): boolean;
	toggle(item: ResourceItem): Promise<void>;
	onChange(listener: () => void): () => void;
}

/** The store a scope writes through. */
function storeFor(discovery: Discovery, scope: WriteScope): SettingsStore {
	return scope === "global" ? discovery.stores.global : discovery.stores.project;
}

export function createExtensionsManagerRuntime(deps: RuntimeDeps): ExtensionsManagerRuntime {
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
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
