/**
 * bytefly — the package's terminal chrome and diagnostics, composed from five
 * feature folders: `header/` (the themed startup mark and version), `footer/`
 * (the two-line, width-adaptive status bar with its price calculation),
 * `separator/` (the transcript turn rule), `picker/` (the `/extensions`
 * manager), and `doctor/` (`/doctor` and `run_doctor`).
 *
 * The header, footer, and turn rule are installed only in interactive (`tui`)
 * sessions; the picker and doctor work in every mode. The footer is priced
 * from DeepSeek's published rates by default and from `bytefly.json`
 * otherwise, and `/bytefly [header|footer|status]` toggles the chrome.
 *
 * Load with:  pi --extension ./extensions/bytefly
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionEnabled } from "../../lib/env.ts";
import { type DoctorDeps, registerDoctor } from "./doctor/register.ts";
import { registerFooter } from "./footer/register.ts";
import { registerHeader } from "./header/register.ts";
import { type CommandDeps, registerExtensionsCommand } from "./picker/commands.ts";
import { registerTurnSeparator } from "./separator/register.ts";

/** Host seams, injected by tests. */
export interface ByteflyDeps {
	/** Seams for the `/extensions` picker. */
	extensions?: CommandDeps;
	/** Seams for the doctor surface. */
	doctor?: DoctorDeps;
}

/** Register every bytefly surface; the factory only registers. */
export default function bytefly(pi: ExtensionAPI, deps: ByteflyDeps = {}): void {
	if (!isExtensionEnabled("bytefly")) return;

	const header = registerHeader(pi);
	registerFooter(pi, { header });
	registerTurnSeparator(pi);
	registerExtensionsCommand(pi, deps.extensions);
	registerDoctor(pi, deps.doctor);
}
