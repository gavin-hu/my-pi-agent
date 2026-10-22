/**
 * Host wiring for resource discovery.
 *
 * Builds the two settings views the screen shows — personal (`global`) and the
 * effective one the session sees (`effective`) — from Pi's public
 * `SettingsManager` and `DefaultPackageManager`, for both resource kinds the
 * screen lists. Both managers and resolvers are built through a small factory
 * seam so tests can supply in-memory doubles instead of touching real settings
 * files or installed packages.
 */

import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { isSelf } from "./resources.ts";
import type { Discovery, ResolvedResources, ResourceResolver, SettingsStore } from "./types.ts";

/** One settings view: the store to write through and its resolved resources. */
interface View {
	store: SettingsStore;
	resolve(): Promise<ResolvedResources>;
}

/** Builds isolated global and project views. Injected by tests. */
export interface DiscoveryFactory {
	global(): View;
	project(): View;
}

export interface DiscoveryDeps {
	cwd: string;
	agentDir?: string;
	trusted: boolean;
	/** Test seam; defaults to real settings files and package resolution. */
	factory?: DiscoveryFactory;
}

/** Adapt Pi's `SettingsManager` to the narrow `SettingsStore` surface. */
export function createSettingsStore(manager: SettingsManager): SettingsStore {
	return {
		globalSettings: () => manager.getGlobalSettings(),
		projectSettings: () => manager.getProjectSettings(),
		packages: () => manager.getPackages(),
		setExtensionPaths: (paths) => manager.setExtensionPaths(paths),
		setSkillPaths: (paths) => manager.setSkillPaths(paths),
		setPackages: (packages) => manager.setPackages(packages),
		setProjectExtensionPaths: (paths) => manager.setProjectExtensionPaths(paths),
		setProjectSkillPaths: (paths) => manager.setProjectSkillPaths(paths),
		setProjectPackages: (packages) => manager.setProjectPackages(packages),
		setQuietStartup: (quiet) => manager.setQuietStartup(quiet),
		setOutputPad: (padding) => manager.setOutputPad(padding),
		setShowHardwareCursor: (enabled) => manager.setShowHardwareCursor(enabled),
		setTheme: (theme) => manager.setTheme(theme),
		isProjectTrusted: () => manager.isProjectTrusted(),
		flush: () => manager.flush(),
		drainErrors: () => manager.drainErrors(),
	};
}

/**
 * The two settings stores the Settings section writes through, without resolving
 * packages: the personal file, plus the project file when the project is
 * trusted (otherwise both point at the personal one).
 */
export function createSettingsStores(
	cwd: string,
	agentDir: string,
	trusted: boolean,
): { global: SettingsStore; project: SettingsStore } {
	const global = createSettingsStore(SettingsManager.create(cwd, agentDir, { projectTrusted: false }));
	const project = trusted
		? createSettingsStore(SettingsManager.create(cwd, agentDir, { projectTrusted: true }))
		: global;
	return { global, project };
}

/** The slice of `DefaultPackageManager` the resolver uses. */
export interface ResolverManager {
	resolve(onMissing?: (source: string) => Promise<"install" | "skip" | "error">): Promise<ResolvedResources>;
}

/** Resolve a settings view's packages into resources, never installing. */
export function createResolver(
	settingsManager: SettingsManager,
	cwd: string,
	agentDir: string,
	manager?: ResolverManager,
): ResourceResolver {
	const packages =
		manager ??
		new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager,
			// Built-in extension names are not exposed to extensions; `pi config`
			// manages those. Package resolution here covers configured packages only.
			builtinExtensions: [],
		});
	return {
		resolve: async () => {
			const resolved = await packages.resolve(async () => "skip");
			return { extensions: resolved.extensions, skills: resolved.skills };
		},
	};
}

/** The real factory: real settings files, real package resolution. */
export function createDiscoveryFactory(cwd: string, agentDir: string): DiscoveryFactory {
	const build = (projectTrusted: boolean): View => {
		const manager = SettingsManager.create(cwd, agentDir, { projectTrusted });
		const resolver = createResolver(manager, cwd, agentDir);
		return { store: createSettingsStore(manager), resolve: () => resolver.resolve() };
	};
	return { global: () => build(false), project: () => build(true) };
}

/**
 * Resolve both views. When the project is untrusted the effective view is the
 * personal one and both stores point at the global settings file, so nothing
 * can read or write project configuration.
 *
 * `bytefly`'s entrypoint — the extension that hosts this picker — is dropped
 * from the extension views, so the picker does not list itself and the row set,
 * the disabled count, and the text listing all agree. Skills have no such self
 * entry, so their lists are passed through untouched.
 */
export async function discoverResources(deps: DiscoveryDeps): Promise<Discovery> {
	const agentDir = deps.agentDir ?? getAgentDir();
	const factory = deps.factory ?? createDiscoveryFactory(deps.cwd, agentDir);

	const globalView = factory.global();
	const global = withoutSelf(await globalView.resolve());

	if (!deps.trusted) {
		return {
			extensions: { global: global.extensions, effective: global.extensions },
			skills: { global: global.skills, effective: global.skills },
			stores: { global: globalView.store, project: globalView.store },
			trusted: false,
		};
	}

	const projectView = factory.project();
	const effective = withoutSelf(await projectView.resolve());
	return {
		extensions: { global: global.extensions, effective: effective.extensions },
		skills: { global: global.skills, effective: effective.skills },
		stores: { global: globalView.store, project: projectView.store },
		trusted: true,
	};
}

/** Drop this extension's own entrypoint from the extension list, and only that. */
function withoutSelf(resources: ResolvedResources): ResolvedResources {
	return { extensions: resources.extensions.filter((item) => !isSelf(item)), skills: resources.skills };
}
