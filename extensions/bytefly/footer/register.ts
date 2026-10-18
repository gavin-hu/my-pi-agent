/**
 * The footer surface: the two-line status bar and the session lifecycle that
 * installs and restores it.
 *
 * The footer is installed only in interactive (`tui`) sessions, and the price
 * configuration is read once per install, so starting a new session or changing
 * the session tree is how an edited `bytefly.json` is picked up. Nothing watches
 * the file. The surface is always on; `pi config` is the way to turn bytefly's
 * chrome off.
 */

import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_FINISHED_CHANNEL } from "../../../lib/events.ts";
import { createSnapshotReader } from "./collect/snapshot.ts";
import { createDelegationLedger } from "./delegation.ts";
import { loadByteflyConfig } from "./price/config.ts";
import { createFooter } from "./render/footer.ts";

/** Register the footer install/restore lifecycle. */
export function registerFooter(pi: ExtensionAPI): void {
	// One ledger per load: it is this session's child-run accounting, priced by
	// whichever reader is installed (a config change installs a new one).
	const delegation = createDelegationLedger();
	pi.events.on(SUBAGENT_FINISHED_CHANNEL, (event) => delegation.note(event));

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		const config = loadByteflyConfig(ctx.cwd);
		const read = createSnapshotReader(config, delegation);

		ctx.ui.setFooter((tui, _theme, footerData) =>
			createFooter(
				tui,
				footerData,
				() => read(ctx, footerData),
				() => ctx.ui.theme,
				homedir(),
			),
		);
	};

	pi.on("session_start", (_event, ctx) => {
		// A new session in this process starts from zero: the ledger is not branch state.
		delegation.reset();
		install(ctx);
	});
	pi.on("session_tree", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
	});
}
