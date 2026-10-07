/**
 * Load-time overrides for the path-taking built-in tools.
 *
 * Pi builds the built-in tools once, bound to the session cwd, and there is no
 * API to rebuild them. Extensions may override a built-in by registering a tool
 * with the same name, but only at load time (first registration per name wins).
 *
 * Every built-in resolves paths with `ctx?.cwd || cwd`, so we register a
 * same-named wrapper that re-runs the real built-in definition with a context
 * whose `cwd` is the active worktree root. The model keeps seeing relative
 * paths; the effective root changes per call.
 *
 * Enforcement (refusing paths outside the worktree) lives in `guard.ts` and is
 * applied centrally from the `tool_call` handler, so nested calls are covered
 * too.
 */

import type { AgentToolResult, ExtensionAPI, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";

export const ROOT_TOOL_NAMES = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
export type RootToolName = (typeof ROOT_TOOL_NAMES)[number];

type AnyToolDef = ToolDefinition<any, any, any>;

interface FactoryOptions {
	read?: { autoResizeImages?: boolean };
	bash?: { commandPrefix?: string; shellPath?: string };
}

function createBuiltin(name: RootToolName, cwd: string, options: FactoryOptions): AnyToolDef {
	switch (name) {
		case "read":
			return createReadToolDefinition(cwd, options.read);
		case "write":
			return createWriteToolDefinition(cwd);
		case "edit":
			return createEditToolDefinition(cwd);
		case "bash":
			return createBashToolDefinition(cwd, options.bash);
		case "grep":
			return createGrepToolDefinition(cwd);
		case "find":
			return createFindToolDefinition(cwd);
		case "ls":
			return createLsToolDefinition(cwd);
	}
}

/**
 * Replace the `cwd` the built-in tool sees, without disturbing any other
 * context field (getters, executeTool, tools). A Proxy delegates everything
 * else to the original context.
 */
function withCwd(ctx: ExtensionToolContext, cwd: string): ExtensionToolContext {
	return new Proxy(ctx, {
		get(target, property, receiver) {
			if (property === "cwd") return cwd;
			return Reflect.get(target, property, receiver);
		},
	});
}

function toolOptions(pi: ExtensionAPI): FactoryOptions {
	const settings = pi.getSettings();
	return {
		read: { autoResizeImages: settings.images?.autoResize ?? true },
		bash: { commandPrefix: settings.shellCommandPrefix, shellPath: settings.shellPath },
	};
}

export interface RootToolHost {
	/** Root every path-taking tool resolves against. */
	getRoot(): string;
	/** Names not to override, for example a tool owned by another extension. */
	getSkipOverrides(): string[];
}

/**
 * Register same-named overrides for every built-in path-taking tool.
 * Should be called once from the extension factory.
 */
export function registerRootTools(pi: ExtensionAPI, host: RootToolHost): void {
	let skip = new Set<string>();
	try {
		skip = new Set(host.getSkipOverrides());
	} catch {
		// Config is not readable yet; override everything.
	}

	for (const name of ROOT_TOOL_NAMES) {
		if (skip.has(name)) continue;
		const template = createBuiltin(name, process.cwd(), {});

		pi.registerTool({
			name,
			label: template.label,
			description: template.description,
			promptSnippet: template.promptSnippet,
			promptGuidelines: template.promptGuidelines,
			parameters: template.parameters,
			outputSchema: template.outputSchema,
			constrainedSampling: template.constrainedSampling,
			annotations: template.annotations,
			// The built-in registration stays responsible for activation; a
			// defaultActive override would re-enable tools a user disabled.
			defaultActive: false,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const root = host.getRoot();
				const definition = createBuiltin(name, root, toolOptions(pi));
				return (await definition.execute(
					toolCallId,
					params,
					signal,
					onUpdate,
					withCwd(ctx, root),
				)) as AgentToolResult<any>;
			},
		});
	}
}
