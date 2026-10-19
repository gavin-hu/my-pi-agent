/**
 * The two reads the update surface makes.
 *
 * The update list comes from Pi's own package manager, so bytefly never decides
 * whether a package is behind: npm ranges, git refs, project scope, missing
 * installs, and `PI_OFFLINE` are all Pi's rules. The second read is only for the
 * header marker: Pi's `PackageUpdate` carries no version, so the new version of
 * this package is asked from the same configured npm command Pi uses.
 *
 * Every failure resolves to `[]` or `undefined`, so a background check never
 * surfaces an error the session did not ask for.
 */

import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PackageUpdate, PackageUpdateCheck } from "./types.ts";

/** How long either read may take before it is abandoned. */
export const UPDATE_TIMEOUT_MS = 10_000;

/** The shape of an exact published version. */
const VERSION_SHAPE = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** The exec seam: the subset of `pi.exec` this module needs. */
export type ExecLike = (
	command: string,
	args: string[],
	options?: { timeout?: number },
) => Promise<{ stdout: string; code?: number }>;

export interface UpdateCheckDeps {
	/** Session working directory. */
	cwd: string;
	/** Pi agent directory; defaults to `getAgentDir()`. */
	agentDir?: string;
	/** Whether project-local packages may be read. */
	projectTrusted: boolean;
	/** Pi's configured npm command, or `npm` when unset. */
	npmCommand?: readonly string[];
	/** The real check captured before suppression; defaults to the manager method. */
	checkForAvailableUpdates?: PackageUpdateCheck;
	/** Command runner; defaults to `pi.exec` in the caller. */
	exec?: ExecLike;
	/** Override {@link UPDATE_TIMEOUT_MS}. */
	timeoutMs?: number;
}

/** Every package Pi would update, or `[]` when the check cannot run. */
export async function fetchAvailableUpdates(deps: UpdateCheckDeps): Promise<PackageUpdate[]> {
	try {
		const settingsManager = SettingsManager.create(deps.cwd, deps.agentDir ?? getAgentDir(), {
			projectTrusted: deps.projectTrusted,
		});
		const manager = new DefaultPackageManager({
			cwd: deps.cwd,
			agentDir: deps.agentDir ?? getAgentDir(),
			settingsManager,
		});
		const check = deps.checkForAvailableUpdates ?? ((current) => current.checkForAvailableUpdates());
		return await check(manager);
	} catch {
		return [];
	}
}

/** The new version of this package, or `undefined` when npm cannot name one. */
export async function fetchOwnLatestVersion(deps: UpdateCheckDeps, packageName: string): Promise<string | undefined> {
	const exec = deps.exec;
	if (!exec) return undefined;
	const [command, ...args] = deps.npmCommand?.length ? deps.npmCommand : ["npm"];
	try {
		const result = await exec(command, [...args, "view", `${packageName}@latest`, "version", "--json"], {
			timeout: deps.timeoutMs ?? UPDATE_TIMEOUT_MS,
		});
		if (result.code !== undefined && result.code !== 0) return undefined;
		const parsed = JSON.parse(result.stdout.trim()) as unknown;
		const version = typeof parsed === "string" ? parsed.trim() : "";
		return VERSION_SHAPE.test(version) ? version : undefined;
	} catch {
		return undefined;
	}
}
