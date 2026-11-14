/**
 * The footer surface: the two-line status bar and the session lifecycle that
 * installs and restores it.
 *
 * The footer is installed only in interactive (`tui`) sessions, and the price
 * configuration and the team are read once per install, so starting a new session or
 * changing the session tree is how an edited `bytefly.json` is picked up. Nothing watches
 * the file. The surface is always on; `pi config` is the way to turn bytefly's chrome off.
 */

import { homedir } from "node:os";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_FINISHED_CHANNEL, TEAM_CHANGED_CHANNEL, type TeamChangedEvent } from "../../../lib/events.ts";
import { asRecord } from "../../../lib/json.ts";
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

/**
 * A payload the bus typed as `unknown`, narrowed to the one channel that carries a team change.
 *
 * The shape is `lib/events.ts`'s and the bus carries nothing else: a consumer that trusted what
 * it was handed would act on any string at all.
 */
function isTeamChanged(value: unknown): value is TeamChangedEvent {
	return typeof asRecord(value)?.cwd === "string";
}

/** Register the footer install/restore lifecycle. */
export function registerFooter(pi: ExtensionAPI, deps: FooterDeps = {}): void {
	// One ledger per load: it is this session's child-run accounting, priced by
	// whichever reader is installed (a config change installs a new one).
	const delegation = createDelegationLedger();
	pi.events.on(SUBAGENT_FINISHED_CHANNEL, (event) => delegation.note(event));

	// The name the bar draws, from the team this install reads. Until that read lands nothing
	// is a teammate, which draws no chip rather than a name the team may not hold.
	let resolveTeammate: (sessionName: string | null) => string | null = () => null;
	/** The directory the installed footer belongs to, so one bar never wears another's team. */
	let installedCwd: string | undefined;
	const readTeam = (cwd: string): void => {
		// Loaded where it is used: the board's config reaches the card record and the lane
		// table, and the registration graph is a budget that may only fall.
		void import("./collect/team.ts")
			.then(({ teammateReader }) => {
				resolveTeammate = teammateReader(cwd, { agentDir: getAgentDir() });
			})
			.catch(() => {});
	};

	// The name the bar draws: the bus label a join settled when there is one, else Pi's own
	// session name, and the team this install reads decides whether either is a name at all.
	// `null` is no record, and a session the team does not hold draws no chip.
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
	/** One warning per crossing: the notice stays in scrollback, and a re-install must not repeat it. */
	let warned = false;
	/** The unpriced notice is once per session too, and independent of the budget. */
	let warnedUnpriced = false;

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		// Not awaited: a footer is installed synchronously, and the bar draws nothing until the
		// team and the record are read — which is what a session off the team shows anyway.
		followLabel(ctx);
		installedCwd = ctx.cwd;
		readTeam(ctx.cwd);
		const config = loadByteflyConfig(ctx.cwd);
		const read = createSnapshotReader(config, delegation, (name) => resolveTeammate(rosterLabel ?? name));
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
		// label belongs to the session, the team is re-read at this install, and a budget that
		// was already reported is unreported again.
		delegation.reset();
		followed = false;
		rosterLabel = null;
		resolveTeammate = () => null;
		warned = false;
		warnedUnpriced = false;
		install(ctx);
	});
	pi.on("session_tree", (_event, ctx) => install(ctx));

	// A team this session changed itself — `/team join <label>` puts its name on the list — so the
	// bar re-reads instead of drawing no chip until the next session tree. The resolver is a
	// closure the snapshot asks every frame, so re-reading it is the whole re-install; a footer
	// installed for another directory keeps the team it read, because a bar must not name a
	// session from a repository it is not showing.
	pi.events.on(TEAM_CHANGED_CHANNEL, (data) => {
		if (!isTeamChanged(data) || budget === undefined || data.cwd !== installedCwd) return;
		readTeam(data.cwd);
	});

	// A turn's cost is final when the run settles, and that is when the user can act
	// on it. Rendering never posts anything: the footer is derived state.
	pi.on("agent_settled", (_event, ctx) => {
		if (!budget || ctx.mode !== "tui") return;
		const peeked = budget.read.peek();
		if (!peeked) return;
		const { usage, delegation } = peeked;
		// A model with no rate contributes nothing: CNY has no fallback, and USD's fallback
		// is Pi's own amount, which is zero for a model its catalog cannot price either.
		if (!warnedUnpriced && usage.unpricedModels.length > 0) {
			warnedUnpriced = true;
			pi.sendMessage(unpricedNotice(usage.unpricedModels));
			deps.notify?.(unpricedBody(usage.unpricedModels));
		}
		if (budget.limit <= 0) return;
		// The ceiling holds the session's spend and the runs it delegated; `↳` keeps the
		// child share, so the bar and this sentence read the same total.
		const state = budgetState(budget.limit, usage.cost + delegation.cost, delegation.cost);
		if (!state.exceeded) {
			// Below the ceiling again, which a `/tree` back below it can do: re-arm the one
			// warning, so the next crossing is reported rather than silently missed.
			warned = false;
			return;
		}
		if (warned) return;
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
