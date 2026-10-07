/**
 * guard — a permission/safety gate for Pi.
 *
 * Registers one `tool_call` handler that hard-blocks writes to protected paths
 * (`.env`, `.git`, lockfiles, keys, `node_modules`), blocks or confirms
 * dangerous shell commands (`rm -rf /`, `dd` to a device, `git push --force`,
 * `sudo`, pipe-to-shell …), and confirms tools annotated as destructive. A
 * confirmation with no UI is blocked unless `nonInteractive` is `"allow"`.
 *
 * The extension is listed last in the package manifest so that worktree's
 * escape guard and plan-mode's read-only block run first; `tool_call` returns
 * on the first block, so guard never double-prompts a call they already refuse.
 *
 * Configuration is merged from `~/.pi/agent/guard.json` and
 * `<cwd>/.pi/guard.json`. `/guard` shows status; `/guard on|off` toggles at
 * runtime (edit the file to persist).
 *
 * Load with:  pi --extension ./extensions/guard
 */

import type { ExtensionAPI, ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { loadConfig, type GuardConfig } from "./config.ts";
import { assessToolCall } from "./policy.ts";

function statusLines(cwd: string, config: GuardConfig, runtimeOverride: boolean | undefined): string[] {
	const state = runtimeOverride === undefined ? (config.enabled ? "on" : "off") : `${runtimeOverride ? "on" : "off"} (runtime)`;
	const overrides = runtimeOverride === undefined ? "" : " — edit guard.json to persist";
	return [
		`Guard: ${state}${overrides}`,
		`Protected paths: ${config.protected.paths.length} (${config.protected.action})`,
		`Commands: ${config.commands.includeBuiltins ? "built-ins" : "no built-ins"} +${config.commands.block.length} block / +${config.commands.confirm.length} confirm / ${config.commands.allow.length} allow`,
		`Destructive annotations: ${config.annotations.confirmDestructive ? "confirm" : "allow"}; no-UI: ${config.nonInteractive}`,
		`Working directory: ${cwd}`,
	];
}

export default function guard(pi: ExtensionAPI): void {
	let cache: { cwd: string; config: GuardConfig } | undefined;
	let runtimeOverride: boolean | undefined;
	const confirmed = new Set<string>();

	const configFor = (cwd: string): GuardConfig => {
		if (!cache || cache.cwd !== cwd) cache = { cwd, config: loadConfig(cwd) };
		return cache.config;
	};

	const effective = (cwd: string): GuardConfig => {
		const base = configFor(cwd);
		return runtimeOverride === undefined ? base : { ...base, enabled: runtimeOverride };
	};

	pi.registerCommand("guard", {
		description: "Show or toggle the guard safety gate",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "on") {
				runtimeOverride = true;
				ctx.ui.notify("Guard on", "info");
				return;
			}
			if (arg === "off") {
				runtimeOverride = false;
				ctx.ui.notify('Guard off (runtime only — edit guard.json to persist)', "warning");
				return;
			}
			if (arg === "paths") {
				const paths = configFor(ctx.cwd).protected.paths;
				ctx.ui.notify(paths.length > 0 ? paths.join("\n") : "No protected paths", "info");
				return;
			}
			ctx.ui.notify(statusLines(ctx.cwd, effective(ctx.cwd), runtimeOverride).join("\n"), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		runtimeOverride = undefined;
		confirmed.clear();
		configFor(ctx.cwd);
	});

	pi.on("session_tree", (_event, ctx) => {
		confirmed.clear();
		configFor(ctx.cwd);
	});

	pi.on("session_shutdown", () => {
		confirmed.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		const config = effective(ctx.cwd);
		if (!config.enabled) return undefined;

		const annotations: ToolAnnotations | undefined = pi
			.getAllTools()
			.find((tool) => tool.name === event.toolName)?.annotations;

		const verdict = assessToolCall({
			toolName: event.toolName,
			input: event.input as Record<string, unknown>,
			cwd: ctx.cwd,
			config,
			annotations,
		});

		if (verdict.action === "allow") return undefined;

		if (verdict.action === "block") {
			if (ctx.hasUI) ctx.ui.notify(`Guard blocked: ${verdict.reason}`, "warning");
			return { block: true, reason: `Guard: ${verdict.reason}` };
		}

		// Confirm.
		if (!ctx.hasUI) {
			if (config.nonInteractive === "allow") return undefined;
			return {
				block: true,
				reason: `Guard: ${verdict.reason} (no UI to confirm; set nonInteractive to "allow" to proceed)`,
			};
		}

		const key = `${verdict.kind}:${verdict.detail}`;
		if (config.rememberConfirmations && confirmed.has(key)) return undefined;

		const approved = await ctx.ui.confirm(
			"Guard — confirm",
			`${verdict.reason}.\n\nAllow this call?`,
			config.confirmTimeoutMs > 0 ? { timeout: config.confirmTimeoutMs } : undefined,
		);

		if (!approved) {
			ctx.ui.notify(`Guard blocked: ${verdict.reason}`, "warning");
			return { block: true, reason: `Guard: ${verdict.reason}` };
		}

		if (config.rememberConfirmations) confirmed.add(key);
		return undefined;
	});
}
