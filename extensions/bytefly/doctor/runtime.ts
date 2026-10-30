/**
 * The doctor runtime: host seams, the session cache, and the two probe modes.
 *
 * The probing itself lives in `lib/requirements.ts`; this module only answers
 * "where is the agent directory", "how do I run a command", and "what did we
 * already find this session". State is closure-scoped, so a reload or a session
 * replacement gets a fresh runtime without leaking the previous session's
 * findings.
 */

import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WebSearchProviderEvent } from "../../../lib/events.ts";
import { PRICE_VERIFIED_AT } from "../footer/price/config.ts";
import { readJsonResult } from "../../../lib/config.ts";
import { extensionDisabledReason } from "../../../lib/env.ts";
import {
	hardRequirementExtensions,
	probeAll as probeDeclared,
	probeExtension,
	REQUIREMENTS,
	type ExtensionReport,
	type ProbeSeams,
} from "../../../lib/requirements.ts";
import { loadNotifyConfig } from "../notify/config.ts";
import { DEFAULT_CONFIG, type DoctorConfig } from "./config.ts";

/** Seams a test may replace; everything else is built from the host. */
export type DoctorSeamOverrides = Partial<ProbeSeams>;

/**
 * The notify capability's configured delivery, read fresh from the document.
 *
 * Reading at probe time rather than from the session's snapshot means a
 * corrected method shows up on the next `r` instead of only after a reload.
 */
export function notifySeam(cwd: string): () => { enabled: boolean; method: string } {
	return () => {
		const notify = loadNotifyConfig(cwd);
		return { enabled: notify.enabled, method: notify.method };
	};
}

export interface DoctorRuntime {
	/** Point the runtime at a session: its cwd and effective config. */
	configure(options: { cwd: string; config: DoctorConfig }): void;
	/** Probe only the extensions that have hard requirements. */
	probeRequired(): Promise<ExtensionReport[]>;
	/** Probe every declared extension, reusing the session cache unless asked. */
	probeAll(options?: { refresh?: boolean }): Promise<ExtensionReport[]>;
	/** The cached reports from the last probe, if any. */
	peek(): ExtensionReport[] | undefined;
	/** Remember the search provider `web-access` published for this session. */
	noteSearchFacts(facts: unknown): void;
	/** Drop the cached reports and the published facts; the configured cwd is kept. */
	reset(): void;
}

/** How long a reachability probe may take; a doctor refresh is not a fetch. */
const REACH_TIMEOUT_MS = 3_000;

/**
 * Probe a URL's reachability. Any HTTP answer proves the host is there; a 5xx is
 * reported because it usually means the server is up but broken.
 */
async function probeReach(url: string): Promise<{ ok: boolean; error?: string }> {
	try {
		const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(REACH_TIMEOUT_MS) });
		return response.status < 500 ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/** Build a runtime over the host's `exec`, with `deps.seams` for tests. */
export function createDoctorRuntime(
	pi: Pick<ExtensionAPI, "exec">,
	deps: { seams?: DoctorSeamOverrides } = {},
): DoctorRuntime {
	let cwd = process.cwd();
	let config: DoctorConfig = DEFAULT_CONFIG;
	let cached: ExtensionReport[] | undefined;
	/** What `web-access` published at session start; absent when it did not load. */
	let searchProvider: WebSearchProviderEvent | undefined;

	/** The full seam set for the current session; `refresh` is the caller's. */
	const seams = (refresh: boolean): ProbeSeams => ({
		exec: async (command, args) => {
			const result = await pi.exec(command, args, { timeout: config.timeoutMs });
			return { code: result.code };
		},
		readJson: readJsonResult,
		dirs: { agentDir: getAgentDir(), cwd, configDirName: CONFIG_DIR_NAME },
		platform: process.platform,
		// The doctor's own skip list is this report's decision, not the environment's,
		// so it answers for the extension it holds back.
		disabledReason: (extension) =>
			config.skip.includes(extension) ? "skipped by `doctor.skip`" : extensionDisabledReason(extension),
		notify: notifySeam(cwd),
		isTTY: process.stdout.isTTY === true,
		searchProvider: () => searchProvider,
		reach: probeReach,
		refresh,
		priceVerifiedAt: () => PRICE_VERIFIED_AT,
		...deps.seams,
	});

	return {
		configure(options) {
			cwd = options.cwd;
			config = options.config;
			cached = undefined;
		},

		async probeRequired() {
			// Concurrent: a probe is a short-lived process, and session start must
			// not wait on the sum of every timeout. Never a refresh: this runs before
			// anyone asked, so no probe may touch the network.
			return Promise.all(hardRequirementExtensions().map((name) => probeExtension(name, seams(false))));
		},

		async probeAll(options = {}) {
			if (cached && !options.refresh) return cached;
			cached = await probeDeclared(seams(options.refresh === true), Object.keys(REQUIREMENTS));
			return cached;
		},

		peek: () => cached,

		noteSearchFacts(facts) {
			searchProvider = facts && typeof facts === "object" ? (facts as WebSearchProviderEvent) : undefined;
		},

		reset() {
			cached = undefined;
			searchProvider = undefined;
		},
	};
}
