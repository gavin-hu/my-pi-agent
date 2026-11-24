/**
 * The model-facing tools this package registers, loaded the way Pi loads them.
 *
 * One loader, three readers: `tool-caps.test.ts` walks each schema's keywords,
 * `prompt-budget.test.ts` sums the text a request pays for, and `naming.test.ts`
 * holds the names. A hand list would pass a tool the model never receives, and a
 * constant's copy is the copy that drifts — so every reader here sees the
 * definition `registerTool` was handed.
 *
 * Each entry is loaded through the fake runtime with the agent directory and the
 * extension env the real load gives it, and the manifest is the package's own
 * `pi.extensions`, so a tool cannot be documented, named, or shaped without
 * being on the surface this returns.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_TOOL_NAMES } from "../../extensions/worktree/root-tools.ts";
import { ALL_EXTENSIONS_ENV, withAgentDir, withEnv } from "./env.ts";
import { createFakePi } from "./fakes.ts";

const root = join(import.meta.dir, "..", "..");

/** The extension entry files the package manifest declares, as Pi loads them. */
const manifest = (JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { pi: { extensions: string[] } }).pi
	.extensions;

/**
 * A parameter schema as JSON Schema, which is what Pi validates against.
 *
 * The shape names only the keywords this package emits and the tests read; the
 * values are Pi's, built by TypeBox, and the cast at the read site names that.
 */
export interface SchemaNode {
	type?: string;
	anyOf?: unknown[];
	const?: unknown;
	properties?: Record<string, SchemaNode>;
	items?: SchemaNode;
	additionalProperties?: SchemaNode | boolean;
	patternProperties?: Record<string, SchemaNode>;
	maxLength?: number;
	maxItems?: number;
	minProperties?: number;
	maxProperties?: number;
	maximum?: number;
	description?: string;
}

/** One registered tool, with the text and schema Pi receives with it. */
export interface RegisteredTool {
	name: string;
	/** The extension entry that registered it, for a failure that names where to look. */
	entry: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: readonly string[];
	parameters?: SchemaNode;
}

/**
 * Every tool a manifest extension registers, minus the host built-ins it overrides.
 *
 * Loaded once per process: the extensions hold module-level registration state, so a
 * second load would register a second `board` onto a fresh fake and measure a tree no
 * request ever sees.
 */
let loadedPromise: Promise<RegisteredTool[]> | undefined;

export function registeredTools(): Promise<RegisteredTool[]> {
	loadedPromise ??= (async () => {
		const tools: RegisteredTool[] = [];
		for (const entry of manifest) {
			const module = (await import(join(root, entry))) as { default?: (pi: unknown) => void };
			await withAgentDir(async () => {
				await withEnv(ALL_EXTENSIONS_ENV, () => {
					const fake = createFakePi();
					module.default?.(fake.pi);
					for (const [name, definition] of fake.tools) tools.push(toolOf(name, entry, definition));
				});
			});
		}
		// The seven path-taking built-ins are Pi's own: this package re-registers them
		// with the session's root, and their schema is the host's to shape.
		const hostTools = new Set<string>(ROOT_TOOL_NAMES);
		return tools.filter((tool) => !hostTools.has(tool.name));
	})();
	return loadedPromise;
}

/** One tool definition as the readers need it. */
function toolOf(name: string, entry: string, definition: unknown): RegisteredTool {
	const tool = definition as {
		description?: string;
		promptSnippet?: string;
		promptGuidelines?: string[];
		parameters?: SchemaNode;
	};
	return {
		name,
		entry,
		description: tool.description ?? "",
		promptSnippet: tool.promptSnippet ?? "",
		promptGuidelines: tool.promptGuidelines ?? [],
		parameters: tool.parameters,
	};
}
