/**
 * doctor — report whether each extension has what it needs at runtime.
 *
 * An extension that is enabled but inert is the failure this exists to prevent:
 * a missing extractor CLI, an optional package that was never installed, a
 * config file with a typo, or a runtime the extension needs but cannot reach.
 * `doctor` knows the answer because each extension declares its prerequisites in
 * `lib/requirements.ts`, and the same probes feed `/doctor` and `run_doctor`.
 *
 * Load with:  pi --extension ./extensions/doctor
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { missingFindings } from "../../lib/requirements.ts";
import { registerCommands } from "./commands.ts";
import { loadConfig } from "./config.ts";
import { formatWarning } from "./format.ts";
import { createDoctorRuntime, type DoctorRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** Test seam: inject a runtime so no test needs a real process. */
export interface DoctorDeps {
	runtime?: DoctorRuntime;
}

export default function doctor(pi: ExtensionAPI, deps: DoctorDeps = {}): void {
	if (!isExtensionEnabled("doctor")) return;
	const runtime = deps.runtime ?? createDoctorRuntime(pi);

	registerTools(pi, runtime);
	registerCommands(pi, runtime);

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		runtime.configure({ cwd: ctx.cwd, config });
		if (!config.proactive || !ctx.hasUI) return;

		// Only hard requirements can break an enabled extension, so the startup
		// probe is limited to the extensions that declare one, in parallel.
		const missing = missingFindings(await runtime.probeRequired());
		if (missing.length > 0) ctx.ui.notify(formatWarning(missing), "warning");
	});

	pi.on("session_shutdown", () => runtime.reset());
}
