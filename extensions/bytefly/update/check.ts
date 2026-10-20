/**
 * The one registry read the update check makes.
 *
 * A fixed, unauthenticated GET of the published `latest` document for this
 * package. It is deliberately not `web-access`'s page runner: there are no
 * redirects to follow, no HTML to extract, and no cache shared with a tool, and
 * extensions may not import one another. Every failure mode — a non-ok status, a
 * body that is not JSON, a payload without a real version, a network error, an
 * abort — resolves to `undefined`, so the caller has one branch and the session
 * never sees an error from a check nobody asked for.
 */

import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import type { PackageUpdate, PackageUpdateCheck } from "./types.ts";
import { parseVersion } from "./version.ts";

/** The published document holding the version npm's `latest` tag points at. */
export const LATEST_VERSION_URL = "https://registry.npmjs.org/@gavin-hu%2Fmy-pi-agent/latest";

/** How long the request may take before it is abandoned. */
export const UPDATE_TIMEOUT_MS = 5_000;

/** The subset of a `fetch` response this check reads. */
export interface LatestResponse {
	readonly ok: boolean;
	json(): Promise<unknown>;
}

/** The fetch seam: narrow enough that a test needs no real response object. */
export type FetchLike = (
	url: string,
	init: { signal: AbortSignal; headers: Record<string, string> },
) => Promise<LatestResponse>;

export interface UpdateCheckDeps {
	/** Replace the network call; defaults to the platform `fetch`. */
	fetch?: FetchLike;
	/** Override {@link UPDATE_TIMEOUT_MS}. */
	timeoutMs?: number;
}

/** What the package-manager read needs. */
export interface AvailableUpdatesDeps {
	/** Session working directory. */
	cwd: string;
	/** Pi agent directory; defaults to `getAgentDir()`. */
	agentDir?: string;
	/** Whether project-local packages may be read. */
	projectTrusted: boolean;
	/** The real check captured before suppression; defaults to the manager method. */
	checkForAvailableUpdates?: PackageUpdateCheck;
}

/**
 * Every package Pi would update, or `undefined` when the check cannot run.
 *
 * The distinction is load-bearing: an empty list is a real answer ("everything is
 * current") that the caller caches for a day, while a failed read must leave the
 * previous snapshot and the header marker alone.
 */
export async function fetchAvailableUpdates(deps: AvailableUpdatesDeps): Promise<PackageUpdate[] | undefined> {
	try {
		const agentDir = deps.agentDir ?? getAgentDir();
		const settingsManager = SettingsManager.create(deps.cwd, agentDir, {
			projectTrusted: deps.projectTrusted,
		});
		const manager = new DefaultPackageManager({ cwd: deps.cwd, agentDir, settingsManager });
		const check = deps.checkForAvailableUpdates ?? ((current) => current.checkForAvailableUpdates());
		return await check(manager);
	} catch {
		return undefined;
	}
}

/** The latest published version, or `undefined` when it cannot be read. */
export async function fetchLatestVersion(deps: UpdateCheckDeps = {}): Promise<string | undefined> {
	const request: FetchLike = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? UPDATE_TIMEOUT_MS);
	try {
		const response = await request(LATEST_VERSION_URL, {
			signal: controller.signal,
			headers: { accept: "application/json" },
		});
		if (!response.ok) return undefined;
		const body = (await response.json()) as { version?: unknown } | undefined;
		const version = typeof body?.version === "string" ? body.version.trim() : "";
		return parseVersion(version) ? version : undefined;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}
