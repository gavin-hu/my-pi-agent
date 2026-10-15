/**
 * bytefly — the package's terminal chrome and diagnostics, composed from six
 * feature folders: `header/` (the themed startup mark and version), `footer/`
 * (the two-line, width-adaptive status bar with its price calculation),
 * `separator/` (the transcript turn rule), `panel/` (the unified `/bytefly`
 * screen, also reachable as `/extensions` and `/doctor`), `doctor/` (the
 * `run_doctor` tool and its session-scoped probe runtime), and `notify/` (OS
 * notifications for unattended runs).
 *
 * The header, footer, and turn rule are installed only in interactive (`tui`)
 * sessions and are always on; `pi config` turns bytefly's chrome off. The panel
 * and doctor work in every mode, and notify works wherever the environment can
 * deliver it. The footer is priced from DeepSeek's published rates by default
 * and from `bytefly.json` otherwise, the same file whose `notify` section
 * configures notifications.
 *
 * Load with:  pi --extension ./extensions/bytefly
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { type DoctorDeps, registerDoctor } from "./doctor/register.ts";
import { registerFooter } from "./footer/register.ts";
import { registerHeader } from "./header/register.ts";
import { type NotifyDeps, registerNotify } from "./notify/register.ts";
import { type PanelCommandDeps, registerPanel } from "./panel/commands.ts";
import { registerTurnSeparator } from "./separator/register.ts";

/** Host seams, injected by tests. */
export interface ByteflyDeps {
	/** Seams for the picker side of the unified panel. */
	extensions?: Pick<PanelCommandDeps, "discover">;
	/** Seams for the doctor surface. */
	doctor?: DoctorDeps;
	/** Seams for the notify capability. */
	notify?: NotifyDeps;
}

/** Register every bytefly surface; the factory only registers. */
export default function bytefly(pi: ExtensionAPI, deps: ByteflyDeps = {}): void {
	if (!isExtensionEnabled("bytefly")) return;

	registerHeader(pi);
	registerFooter(pi);
	registerTurnSeparator(pi);
	const doctor = registerDoctor(pi, deps.doctor);
	registerPanel(pi, { doctor, discover: deps.extensions?.discover });
	registerNotify(pi, deps.notify);
}
