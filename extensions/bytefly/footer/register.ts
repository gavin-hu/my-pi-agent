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
	let resolveTeammate: (label: string | null) => string | null = () => null;
	/** The directory the installed footer belongs to, so one bar never wears another's team. */
	let installedCwd: string | undefined;
	const readTeam = (cwd: string): void => {
		// Loaded where it is used: the board's config reaches the card record and the lane
		// table, and the registration graph is a budget that may only fall.
		void import("./collect/team.ts")
			.then(({ worktreeTeammateReader }) => worktreeTeammateReader(pi, cwd, { agentDir: getAgentDir() }))
			.then((reader) => {
				resolveTeammate = reader;
			})
			.catch(() => {});
	};

	// The name the bar draws: the label a join settled for this session, and the team this install
	// reads decides whether it is a name at all. `null` is no record, and a session the team does
	// not hold draws no chip.
	let rosterLabel: string | null = null;
	/** Whether this session's label is being followed: a tree change re-installs, it is not new. */
	let followed = false;
	/** The live subscription's way out, and which install made it: a load that lands late drops its own. */
	let stopLabel: (() => void) | undefined;
	let installSeq = 0;
	const followLabel = (ctx: ExtensionContext): void => {
		if (followed) return;
		followed = true;
		const seq = ++installSeq;
		// Loaded where it is used: the follower walks the bus's layout on disk and subscribes to
		// its label, and the registration graph is a budget that may only fall.
		void import("./collect/label.ts")
			.then(({ followRosterLabel }) => {
				const follower = followRosterLabel({
					pi,
					ctx,
					agentDir: getAgentDir(),
					sink: (label) => {
						rosterLabel = label;
					},
				});
				// A reset that landed while the module was loading has already asked for the listener it
				// wants: this one would be a second, and nothing would ever drop it.
				if (seq === installSeq) stopLabel = follower.stop;
				else follower.stop();
			})
			.catch(() => {});
	};

	/** The installed reader, while a footer is up: the unpriced notice reads it after a turn. */
	let installedRead: SnapshotReader | undefined;
	/** The unpriced notice is once per session, so a re-install must not repeat it. */
	let warnedUnpriced = false;

	const install = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;
		// Not awaited: a footer is installed synchronously, and the bar draws nothing until the
		// team and the record are read — which is what a session off the team shows anyway.
		followLabel(ctx);
		installedCwd = ctx.cwd;
		readTeam(ctx.cwd);
		const config = loadByteflyConfig(ctx.cwd);
		const read = createSnapshotReader(config, delegation, () => resolveTeammate(rosterLabel));
		installedRead = read;

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
		// label belongs to the session, and the team is re-read at this install.
		delegation.reset();
		// The transcript this install belongs to is not the one the listener was made for, so the
		// listener goes first: a `/new` reuses the process, and one subscription is the number.
		stopLabel?.();
		stopLabel = undefined;
		followed = false;
		rosterLabel = null;
		resolveTeammate = () => null;
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
		if (!isTeamChanged(data) || installedRead === undefined || data.cwd !== installedCwd) return;
		readTeam(data.cwd);
	});

	// A turn's cost is final when the run settles, and that is when the user can act
	// on it. Rendering never posts anything: the footer is derived state.
	pi.on("agent_settled", (_event, ctx) => {
		if (!installedRead || ctx.mode !== "tui") return;
		const peeked = installedRead.peek();
		if (!peeked) return;
		// A model with no rate contributes nothing: CNY has no fallback, and USD's fallback
		// is Pi's own amount, which is zero for a model its catalog cannot price either.
		const { unpricedModels } = peeked;
		if (warnedUnpriced || unpricedModels.length === 0) return;
		warnedUnpriced = true;
		pi.sendMessage(unpricedNotice(unpricedModels));
		deps.notify?.(unpricedBody(unpricedModels));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		installedRead = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
	});
}
