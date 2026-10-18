/**
 * bytefly — the package's terminal chrome and diagnostics, composed from eleven
 * feature folders: `header/` (the themed startup mark and version), `footer/`
 * (the two-line, width-adaptive status bar with its price calculation),
 * `message/` (the user-message nameplate), `notice/` (the shared transcript
 * notice renderer), `block/` (the unified tool-block frame), `separator/` (the
 * transcript turn rule), `working/` (the live elapsed counter on Pi's working
 * row), `panel/` (the unified `/bytefly` screen and its
 * `doctor` report), `doctor/` (the `run_doctor` tool and its session-scoped
 * probe runtime), `notify/` (OS notifications for unattended runs), and
 * `update/` (the published-version check behind the header's update marker).
 *
 * The header, footer, turn rule, and working timer are installed only in
 * interactive (`tui`) sessions, and are always on; the user-message marker,
 * notice, and tool blocks register at load and take effect wherever a
 * transcript renders. `pi config` turns bytefly's chrome off. The panel and doctor work
 * in every mode, and notify works wherever the environment can deliver it. The
 * footer is priced from DeepSeek's published rates by default and from
 * `bytefly.json` otherwise, the same file whose `notify` section configures
 * notifications.
 *
 * Load with:  pi --extension ./extensions/bytefly
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { registerToolBlocks } from "./block/register.ts";
import { registerChrome } from "./chrome.ts";
import { type DoctorDeps, registerDoctor } from "./doctor/register.ts";
import { registerFooter } from "./footer/register.ts";
import { registerHeader } from "./header/register.ts";
import { registerUserMessage } from "./message/register.ts";
import { registerNotice } from "./notice/register.ts";
import { type NotifyDeps, registerNotify } from "./notify/register.ts";
import { createPadStore } from "./pad.ts";
import { type PanelCommandDeps, registerPanel } from "./panel/commands.ts";
import { registerTurnSeparator } from "./separator/register.ts";
import { registerUpdate, type UpdateDeps } from "./update/register.ts";
import { createUpdateState } from "./update/state.ts";
import { registerWorkingTimer } from "./working/register.ts";

/** Host seams, injected by tests. */
export interface ByteflyDeps {
	/** Seams for the picker side of the unified panel. */
	extensions?: Pick<PanelCommandDeps, "discover">;
	/** Seams for the doctor surface. */
	doctor?: DoctorDeps;
	/** Seams for the notify capability. */
	notify?: NotifyDeps;
	/** Seams for the published-version check. */
	update?: UpdateDeps;
}

/** Register every bytefly surface; the factory only registers. */
export default function bytefly(pi: ExtensionAPI, deps: ByteflyDeps = {}): void {
	if (!isExtensionEnabled("bytefly")) return;

	// One store per load: the update check writes the newest published version and
	// the header reads it, so the marker and every re-install agree.
	const updates = createUpdateState();
	const header = registerHeader(pi, updates);
	registerFooter(pi);
	registerUserMessage(pi);
	// One store per load: the tool frame and the notice record Pi's output pad and
	// the turn separator reads it, so bytefly's transcript blocks share one margin.
	const pad = createPadStore();
	// The rail glyph is read from `bytefly.json` at session start; the tool results
	// and the notice read it through this one store.
	const rail = registerChrome(pi);
	registerNotice(pi, pad, rail);
	registerToolBlocks(pi, pad, rail);
	registerTurnSeparator(pi, pad);
	registerWorkingTimer(pi);
	const doctor = registerDoctor(pi, deps.doctor);
	registerPanel(pi, { doctor, discover: deps.extensions?.discover });
	registerNotify(pi, deps.notify);
	// Last, so a version that arrives after startup can re-install the header.
	registerUpdate(pi, updates, { ...deps.update, onUpdate: () => header.refresh() });
}
