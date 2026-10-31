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
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_FINISHED_CHANNEL } from "../../../lib/events.ts";
import { budgetBody, budgetNotice, budgetState } from "./budget.ts";
import { createSnapshotReader, type SnapshotReader } from "./collect/snapshot.ts";
import { createDelegationLedger } from "./delegation.ts";
import { loadByteflyConfig } from "./price/config.ts";
import { createFooter } from "./render/footer.ts";
import { unpricedBody, unpricedNotice } from "./unpriced.ts";

/** Host seams, injected by the composition root and by tests. */
export interface FooterDeps {
	/** Raise one OS notification through bytefly's notify capability. */
	notify?: (body: string) => void;
}

/** Register the footer install/restore lifecycle. */
export function registerFooter(pi: ExtensionAPI, deps: FooterDeps = {}): void {
	// One ledger per load: it is this session's child-run accounting, priced by
	// whichever reader is installed (a config change installs a new one).
	const delegation = createDelegationLedger();
	pi.events.on(SUBAGENT_FINISHED_CHANNEL, (event) => delegation.note(event));

	// The label a peer knows this session by, once the follower below reports one; `null` is
	// no record, and the bar keeps Pi's own session name.
	let rosterLabel: string | null = null;
	/** Whether this session's label is being followed: a tree change re-installs, it is not new. */
	let followed = false;
	const followLabel = (ctx: ExtensionContext): void => {
		if (followed) return;
		followed = true;
		// Loaded where it is used: the follower walks the bus's layout on disk and subscribes to
		// its label, and the registration graph is a budget that may only fall.
		void import("./collect/label.ts")
			.then(({ followRosterLabel }) =>
				followRosterLabel({
					pi,
					ctx,
					agentDir: getAgentDir(),
					sink: (label) => {
						rosterLabel = label;
					},
				}),
			)
			.catch(() => {});
	};

	/** The installed reader and the budget it was priced with, while a footer is up. */
	let budget: { limit: number; read: SnapshotReader } | undefined;
	/** One warning per session: the notice stays in scrollback, and a re-install must not repeat it. */
	let warned = false;
	/** The unpriced notice is once per session too, and independent of the budget. */
	let warnedUnpriced = false;

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		// Not awaited: a footer is installed synchronously, and the bar draws Pi's name until the
		// label lands — which is what a session with no record shows anyway.
		followLabel(ctx);
		const config = loadByteflyConfig(ctx.cwd);
		const read = createSnapshotReader(config, delegation, () => rosterLabel);
		budget = { limit: config.budget, read };

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
		// A new session in this process starts from zero: the ledger is not branch state, the
		// label belongs to the session, and a budget that was already reported is unreported again.
		delegation.reset();
		followed = false;
		rosterLabel = null;
		warned = false;
		warnedUnpriced = false;
		install(ctx);
	});
	pi.on("session_tree", (_event, ctx) => install(ctx));

	// A turn's cost is final when the run settles, and that is when the user can act
	// on it. Rendering never posts anything: the footer is derived state.
	pi.on("agent_settled", (_event, ctx) => {
		if (!budget || ctx.mode !== "tui") return;
		const usage = budget.read.peek();
		if (!usage) return;
		// A model with no rate contributes nothing: CNY has no fallback, and USD's fallback
		// is Pi's own amount, which is zero for a model its catalog cannot price either.
		if (!warnedUnpriced && usage.unpricedModels.length > 0) {
			warnedUnpriced = true;
			pi.sendMessage(unpricedNotice(usage.unpricedModels));
			deps.notify?.(unpricedBody(usage.unpricedModels));
		}
		if (warned || budget.limit <= 0) return;
		const state = budgetState(budget.limit, usage.cost);
		if (!state.exceeded) return;
		warned = true;
		const currency = loadByteflyConfig(ctx.cwd).currency;
		pi.sendMessage(budgetNotice(state, currency));
		deps.notify?.(budgetBody(state, currency));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		budget = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
	});
}
