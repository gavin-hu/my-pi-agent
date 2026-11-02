/**
 * The background surface, loaded on first use.
 *
 * The tool is what every session pays for. A run started with `background: true`,
 * the `/agents` board and the footer chip are not, so they sit behind this one
 * module the entry imports and build themselves here. Pi builds its command
 * palette at load, so `/agents` is registered from here — a command registered
 * later never reaches the palette — and only its handler waits.
 *
 * The runtime is built once per process and then owned by `start`/`shutdown`,
 * which the entry routes its session hooks to. Nothing here runs for a session
 * that never delegates in the background.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	BackgroundRunDeps,
	BackgroundRuntime,
	BackgroundStartInput,
	BackgroundStartResult,
} from "./background.ts";
import type { SubagentUiController } from "./ui.ts";

/** What the entry needs from the surface. */
export interface BackgroundSurface {
	/** Put `/agents` in the palette; the stack loads when its handler first runs. */
	register(): void;
	/** Reset and re-attach a surface a previous session in this process built. */
	start(ctx: ExtensionContext): void;
	/** Abort live children and clear the chip. */
	shutdown(): void;
	/** Start one background run, building the surface if this is the first. */
	startRun(
		input: BackgroundStartInput,
		branch: readonly unknown[],
		deps: BackgroundRunDeps,
		ctx: ExtensionContext,
	): Promise<BackgroundStartResult>;
}

/** The runtime and the chip, once they exist. */
interface Loaded {
	background: BackgroundRuntime;
	ui: SubagentUiController;
}

/**
 * Register `/agents` over a runtime that is asked for when the command runs.
 *
 * Split from `createBackgroundSurface` so a suite can hand it a stub runtime and
 * still exercise the registration production uses — one registration, one handler.
 */
export function registerAgentsCommand(
	pi: ExtensionAPI,
	runtimeFor: (ctx: ExtensionCommandContext) => Promise<BackgroundRuntime>,
): void {
	pi.registerCommand("agents", {
		description: "Inspect, collect, or cancel background subagent runs",
		handler: async (_args, ctx) => {
			const { openAgents } = await import("./commands.ts");
			await openAgents(pi, await runtimeFor(ctx), ctx);
		},
	});
}

export function createBackgroundSurface(pi: ExtensionAPI): BackgroundSurface {
	let loaded: Loaded | undefined;
	let building: Promise<Loaded> | undefined;
	let ctx: ExtensionContext | undefined;
	let unsubscribe: (() => void) | undefined;

	/** Attach the chip to the session, once. */
	const attach = (): void => {
		if (!loaded || ctx === undefined) return;
		loaded.ui.attach(ctx);
		if (unsubscribe === undefined) unsubscribe = loaded.background.subscribe(() => loaded?.ui.paint());
		loaded.ui.paint();
	};

	/** Build the runtime and the chip, once per process, and attach them. */
	const ensure = (next: ExtensionContext): Promise<Loaded> => {
		ctx = next;
		// A rejected build is retried by the next first use, not remembered as a poisoned
		// promise for the rest of the process.
		building ??= (async () => {
			const [{ createBackgroundRuntime }, { createSubagentUi }] = await Promise.all([
				import("./background.ts"),
				import("./ui.ts"),
			]);
			let chip: SubagentUiController | undefined;
			const background = createBackgroundRuntime({
				appendEntry: (customType, data) => pi.appendEntry(customType, data),
				onFinish: (run) => chip?.notifyFinished(run),
			});
			chip = createSubagentUi({ runs: () => background.list(ctx?.sessionManager.getBranch() ?? []) });
			loaded = { background, ui: chip };
			attach();
			return loaded;
		})().catch((error: unknown) => {
			building = undefined;
			loaded = undefined;
			throw error;
		});
		return building;
	};

	return {
		register() {
			registerAgentsCommand(pi, async (next) => (await ensure(next)).background);
		},
		start(next) {
			ctx = next;
			if (!loaded) return;
			// A reset empties the runtime's listeners, so the handle from the last attach is
			// dead: drop it before attaching, or the chip never subscribes again.
			loaded.background.reset();
			unsubscribe = undefined;
			attach();
		},
		shutdown() {
			// Cleared even when nothing was built: a build that lands after this shutdown must
			// not attach to a context Pi has already invalidated.
			ctx = undefined;
			if (!loaded) return;
			loaded.background.shutdown();
			loaded.ui.detach();
			unsubscribe?.();
			unsubscribe = undefined;
		},
		async startRun(input, branch, deps, next) {
			const { background } = await ensure(next);
			return background.start(input, branch, deps);
		},
	};
}
