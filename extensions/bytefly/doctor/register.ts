/**
 * bytefly's doctor surface: the `run_doctor` tool and the proactive
 * session-start check.
 *
 * An extension that is enabled but inert is the failure this exists to prevent:
 * a missing extractor CLI, an optional package that was never installed, a
 * config file with a typo, or a runtime the extension needs but cannot reach.
 * `doctor` knows the answer because each extension declares its prerequisites in
 * `lib/requirements.ts`, and the same probes feed the unified panel and
 * `run_doctor`.
 *
 * This module registers itself from bytefly's factory; it has no env guard of
 * its own because `PI_DISABLED_EXTENSIONS=bytefly` is what disables it. It
 * creates the session-scoped runtime and returns it so the composition root can
 * hand the same cache to the panel.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { missingFindings } from "../../../lib/requirements.ts";
import { loadConfig } from "./config.ts";
import { formatWarning } from "./format.ts";
import { createDoctorRuntime, type DoctorRuntime } from "./runtime.ts";
import { registerTools } from "./tools.ts";

/** Test seam: inject a runtime so no test needs a real process. */
export interface DoctorDeps {
	runtime?: DoctorRuntime;
}

/**
 * Register the doctor surface and return its runtime.
 *
 * Registers the read-only tool, points the runtime at each session, and drops
 * the cached findings on shutdown. `/bytefly` and its aliases are registered by
 * the panel, which shares this runtime.
 */
export function registerDoctor(pi: ExtensionAPI, deps: DoctorDeps = {}): DoctorRuntime {
	const runtime = deps.runtime ?? createDoctorRuntime(pi);

	registerTools(pi, runtime);

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		runtime.configure({ cwd: ctx.cwd, config });
		if (!config.proactive || !ctx.hasUI) return;
		// `quietStartup: true` hides Pi's own startup detail, and this warning is
		// startup detail too. `"header"` keeps the header, so it still warns.
		if (pi.getSettings?.().quietStartup === true) return;

		// Only hard requirements can break an enabled extension, so the startup
		// probe is limited to the extensions that declare one, in parallel.
		const missing = missingFindings(await runtime.probeRequired());
		if (missing.length > 0) ctx.ui.notify(formatWarning(missing), "warning");
	});

	pi.on("session_shutdown", () => runtime.reset());

	return runtime;
}
