/**
 * Fixture for booting the bytefly extension.
 *
 * `makeByteflyPi` is the shared `ExtensionAPI` double narrowed to what bytefly
 * registers; `bootBytefly` calls the shipped extension factory over it with the
 * update check made inert, because a test that boots bytefly must never read npm
 * or write the agent directory.
 *
 * Value-only: both builders create their recorders per call.
 */

import type { MarkdownTransformer, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import bytefly from "../../../extensions/bytefly/index.ts";
import { createFakePi, type AnyHandler } from "../fakes.ts";

interface ByteflyPi {
	pi: any;
	tools: Map<string, any>;
	commands: Map<string, any>;
	handlers: Map<string, AnyHandler[]>;
	renderers: Map<string, any>;
	messageRenderers: Map<string, any>;
	toolRenderers: ToolRendererResolver[];
	markdownTransformers: MarkdownTransformer[];
	appended: Array<{ customType: string; data?: unknown }>;
}

/** Minimal `ExtensionAPI` double covering what the bytefly extension uses. */
export function makeByteflyPi(options: { settings?: any } = {}): ByteflyPi {
	const fake = createFakePi({ settings: options.settings });
	return {
		pi: fake.pi,
		tools: fake.tools,
		commands: fake.commands,
		handlers: fake.handlers,
		renderers: fake.renderers,
		messageRenderers: fake.messageRenderers,
		toolRenderers: fake.toolRenderers,
		markdownTransformers: fake.markdownTransformers,
		appended: fake.appended,
	};
}

/**
 * Update-check deps that make the check inert: offline, with an empty cache, so a
 * test that boots bytefly never reads npm and never writes the agent directory.
 */
export const OFFLINE_UPDATE = {
	fetchLatest: async () => undefined,
	readUpdates: async () => [],
	isOffline: () => true,
	cache: { read: () => undefined, write: () => {} },
	suppress: () => ({ check: async () => [], restore: () => {} }),
};

/** Boot bytefly over `deps`, with the update check inert. */
export function bootBytefly(pi: any, deps: Record<string, unknown> = {}): void {
	bytefly(pi, { update: OFFLINE_UPDATE, ...deps } as any);
}
