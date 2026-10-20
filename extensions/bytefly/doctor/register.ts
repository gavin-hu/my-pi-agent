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
import { WEB_SEARCH_PROVIDER_CHANNEL } from "../../../lib/events.ts";
import { missingFindings } from "../../../lib/requirements.ts";
import { loadConfig } from "./config.ts";
import { warningNotice } from "./format.ts";
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

	// `web-access` publishes what it resolved at session start; the doctor reports
	// the provider, its key variable, and (on a refresh) its endpoint from that,
	// without importing the extension.
	pi.events.on(WEB_SEARCH_PROVIDER_CHANNEL, (facts) => runtime.noteSearchFacts(facts));

	// Bumped when a session starts or ends, so a probe that outlives its session
	// cannot post its notice into the next one (a reload re-registers the surface).
	let probeToken = 0;

	pi.on("session_start", (_event, ctx) => {
		const config = loadConfig(ctx.cwd);
		runtime.configure({ cwd: ctx.cwd, config });
		if (!config.proactive || !ctx.hasUI) return;
		// The startup notice is part of bytefly's startup TUI, which is on only
		// when Pi's `quietStartup` is true. `false`, `"header"`, and unset leave
		// Pi's startup surface in charge, so bytefly stays quiet.
		if (pi.getSettings?.().quietStartup !== true) return;

		// Only hard requirements can break an enabled extension, so the startup
		// probe is limited to the extensions that declare one, in parallel. Fired
		// without awaiting: Pi awaits every `session_start` handler, and these
		// probes spawn processes, so holding the first prompt on them is the cost
		// this avoids. The notice lands a moment later, in the flow, as before.
		const token = ++probeToken;
		void runtime
			.probeRequired()
			.then((reports) => {
				if (token !== probeToken) return;
				const missing = missingFindings(reports);
				if (missing.length > 0) pi.sendMessage(warningNotice(missing));
			})
			.catch(() => {
				// A background check never surfaces an error, and the report is advice.
			});
	});

	pi.on("session_shutdown", () => {
		probeToken += 1;
		runtime.reset();
	});

	return runtime;
}
