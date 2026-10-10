/**
 * keep-awake runtime: the state machine that decides when an OS inhibitor is
 * held, spawns it, and publishes the status chip.
 *
 * State comes from four signals — session active, agent running, the configured
 * mode, and the per-session override — and every transition calls `reconcile`,
 * which is idempotent. The status chip is derived from the runtime on each
 * reconcile; nothing else holds UI state.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import { stateLabel } from "./format.ts";
import { buildInhibitorCommand } from "./inhibitor.ts";
import { defaultKillTree, defaultSpawn, type KillTreeFn, type SpawnFn, type SpawnedProcess } from "./process.ts";
import type { KeepAwakeConfig, KeepAwakeOverride, KeepAwakeStatus } from "./types.ts";

/** Injectable host seams, so tests never spawn a real process. */
export interface KeepAwakeDeps {
	spawn?: SpawnFn;
	killTree?: KillTreeFn;
	platform?: NodeJS.Platform;
	piPid?: number;
	config?: KeepAwakeConfig;
}

export interface KeepAwakeRuntime {
	/** `session_start`: arm, clear the override, and reconcile. */
	start(ctx: ExtensionContext): void;
	/** `session_shutdown`: release the inhibitor and clear the chip. Idempotent. */
	stop(ctx: ExtensionContext): void;
	/** `agent_start`: mark the agent running (drives `auto`). */
	agentStart(ctx: ExtensionContext): void;
	/** `agent_settled`: mark the agent idle (drives `auto`). */
	agentSettled(ctx: ExtensionContext): void;
	/** Set or clear the per-session command override, then reconcile. */
	setOverride(override: KeepAwakeOverride | undefined, ctx: ExtensionContext): void;
	/** Current view, for the command. */
	status(): KeepAwakeStatus;
}

/** Build a runtime backed by the default process primitives. */
export function createKeepAwakeRuntime(deps: KeepAwakeDeps = {}): KeepAwakeRuntime {
	const config = deps.config ?? DEFAULT_CONFIG;
	const platform = deps.platform ?? process.platform;
	const piPid = deps.piPid ?? process.pid;
	const spawn = deps.spawn ?? defaultSpawn;
	const killTree = deps.killTree ?? defaultKillTree;

	let sessionActive = false;
	let agentRunning = false;
	let override: KeepAwakeOverride | undefined;
	let child: SpawnedProcess | undefined;
	let unavailable: string | undefined;

	const snapshot = (): KeepAwakeStatus => ({
		active: child !== undefined,
		mode: config.mode,
		override,
		platform,
		unavailable,
	});

	const desired = (): boolean => {
		if (!sessionActive || unavailable) return false;
		if (override === "off") return false;
		if (override === "on") return true;
		return config.mode === "always" ? true : agentRunning;
	};

	const publish = (ctx: ExtensionContext): void => {
		try {
			if (child === undefined) {
				ctx.ui.setStatus(STATUS_KEYS.keepAwake, undefined);
				return;
			}
			const theme = ctx.ui.theme;
			const chip = `${theme.fg("success", GLYPHS.keepAwake)} ${theme.fg("accent", stateLabel(snapshot()))}`;
			ctx.ui.setStatus(STATUS_KEYS.keepAwake, chip);
		} catch {
			// The UI may already be gone; the chip is cosmetic.
		}
	};

	const release = (): void => {
		const spawned = child;
		child = undefined;
		if (!spawned) return;
		if (spawned.pid !== undefined) {
			try {
				killTree(spawned.pid, "SIGTERM");
			} catch {
				// Already gone.
			}
			return;
		}
		try {
			spawned.kill("SIGTERM");
		} catch {
			// Already gone.
		}
	};

	const acquire = (ctx: ExtensionContext): void => {
		if (child || !desired()) return;
		const command = buildInhibitorCommand(platform, { keepDisplay: config.keepDisplay, piPid });
		if (command === undefined) {
			unavailable = `no keep-awake command for ${platform}`;
			return;
		}
		// A spawn error (missing binary) or an unexplained exit means the
		// inhibitor is not holding; record it and stop retrying for the session.
		const fail = (spawned: SpawnedProcess, reason: string): void => {
			if (child !== spawned) return;
			child = undefined;
			unavailable = reason;
			publish(ctx);
		};
		try {
			const spawned = spawn(command, { cwd: process.cwd() });
			spawned.on("error", (error: Error) => fail(spawned, error.message));
			spawned.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
				const detail = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
				fail(spawned, `keep-awake inhibitor exited unexpectedly (${detail})`);
			});
			child = spawned;
		} catch (error) {
			unavailable = error instanceof Error ? error.message : String(error);
		}
	};

	const reconcile = (ctx: ExtensionContext): void => {
		if (desired()) acquire(ctx);
		else release();
		publish(ctx);
	};

	return {
		status: snapshot,
		start: (ctx) => {
			sessionActive = true;
			agentRunning = false;
			override = undefined;
			unavailable = undefined;
			reconcile(ctx);
		},
		stop: (ctx) => {
			sessionActive = false;
			agentRunning = false;
			release();
			publish(ctx);
		},
		agentStart: (ctx) => {
			agentRunning = true;
			reconcile(ctx);
		},
		agentSettled: (ctx) => {
			agentRunning = false;
			reconcile(ctx);
		},
		setOverride: (value, ctx) => {
			override = value;
			reconcile(ctx);
		},
	};
}
