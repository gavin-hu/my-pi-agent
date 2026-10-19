/**
 * The update surface's lifecycle: hand the package list to Pi's own manager,
 * record it once per interactive session, and announce it once per load.
 *
 * Pi would draw its own `Package Updates Available` block from the same list
 * after `session_start`. bytefly suppresses that block, asks the captured
 * original check itself, and draws the single notice. The request is fired
 * without awaiting: Pi awaits `session_start` handlers, and a slow `npm view`
 * must not hold the first prompt.
 *
 * Every result that is not a non-empty list is silent, and a generation counter
 * keeps a request that resolves after shutdown from writing into the next
 * session's state.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import pkg from "../../../package.json";
import { fetchAvailableUpdates, fetchOwnLatestVersion } from "./check.ts";
import { updateNotice } from "./format.ts";
import type { UpdateSource } from "./state.ts";
import type { PackageUpdate, PackageUpdateCheck } from "./types.ts";
import { suppressPiPackageUpdates, type UpdateSuppression } from "./suppress.ts";

/** Test seams; production uses Pi's package manager and its configured npm. */
export interface UpdateDeps {
	/** Replace the package-manager read. */
	readUpdates?: (ctx: ExtensionContext, check: PackageUpdateCheck) => Promise<PackageUpdate[]>;
	/** Replace the header version lookup. */
	readLatest?: (ctx: ExtensionContext, packageName: string) => Promise<string | undefined>;
	/** Replace the host suppression; defaults to patching Pi's package manager. */
	suppress?: () => UpdateSuppression;
	/** Called once a snapshot is recorded, so a mounted header repaints. */
	onUpdate?: () => void;
}

/** Whether a package update is this package, whose version the header shows. */
function isOwnPackage(update: PackageUpdate): boolean {
	return update.type === "npm" && update.displayName === pkg.name;
}

/** Register the update lifecycle. `updates` is the store the header reads. */
export function registerUpdate(pi: ExtensionAPI, updates: UpdateSource, deps: UpdateDeps = {}): void {
	const suppress = deps.suppress ?? suppressPiPackageUpdates;
	const readUpdates =
		deps.readUpdates ??
		((ctx, check) =>
			fetchAvailableUpdates({
				cwd: ctx.cwd,
				agentDir: getAgentDir(),
				projectTrusted: ctx.isProjectTrusted(),
				npmCommand: pi.getSettings?.().npmCommand,
				checkForAvailableUpdates: check,
			}));
	const readLatest =
		deps.readLatest ??
		((ctx, packageName) =>
			fetchOwnLatestVersion(
				{
					cwd: ctx.cwd,
					agentDir: getAgentDir(),
					projectTrusted: ctx.isProjectTrusted(),
					npmCommand: pi.getSettings?.().npmCommand,
					exec: (command, args, options) => pi.exec(command, args, options),
				},
				packageName,
			));
	// A session is announced at most once per load, even if `session_start` fires
	// again after a resume or a session replacement.
	let announced = false;
	let generation = 0;
	let suppression: UpdateSuppression | undefined;

	const check = async (ctx: ExtensionContext, token: number): Promise<void> => {
		try {
			const list = await readUpdates(ctx, suppression?.check ?? (async () => []));
			if (token !== generation) return;
			if (announced || list.length === 0) return;
			announced = true;
			const own = list.find(isOwnPackage);
			const ownLatest = own ? await readLatest(ctx, pkg.name) : undefined;
			if (token !== generation) return;
			updates.set(list, ownLatest);
			deps.onUpdate?.();
			pi.sendMessage(updateNotice(list));
		} catch {
			// A background check never surfaces an error: the session does not know it ran.
		}
	};

	pi.on("session_start", (_event, ctx) => {
		// The header and notice are transcript surfaces, so a non-interactive run
		// neither suppresses Pi's block nor makes a request.
		if (ctx.mode !== "tui") return;
		suppression ??= suppress();
		if (announced) return;
		void check(ctx, generation);
	});

	pi.on("session_shutdown", () => {
		// Invalidate any request still in flight, drop what this session found, and
		// give Pi's own check back to the host.
		generation++;
		updates.set();
		suppression?.restore();
		suppression = undefined;
	});
}
