/**
 * What the package's tree actually holds, derived rather than listed.
 *
 * Two kinds of question live here, both of them facts a document states and no type
 * checker sees:
 *
 * - **The catalog**: how many extensions the manifest declares, how many packaged
 *   skills, and how many themes. A prose count is the first thing to rot, because
 *   nothing breaks when it does.
 * - **The surface**: the tool names one extension registers. `worktree`
 *   re-registers Pi's seven path tools rather than adding tools of its own, so
 *   those are filtered out wherever the question is "what does this extension
 *   put in front of the model".
 *
 * Loading a factory needs the fake host and a temp agent directory, so every value
 * here is a cache of one load per process: `bun test` isolates files, and the load is
 * the slowest thing a doc guard does.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_TOOL_NAMES } from "../../extensions/worktree/root-tools.ts";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { withAgentDir, withEnv } from "./env.ts";
import { createFakePi } from "./fakes.ts";

const root = join(import.meta.dir, "..", "..");

/** The extension entry files the package manifest declares. */
export const manifest: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")).pi.extensions;

/** How many entries of `directory` are directories, optionally only those carrying `required`. */
function countDirectories(directory: string, required?: string): number {
	return readdirSync(join(root, directory), { withFileTypes: true }).filter(
		(entry) =>
			entry.isDirectory() && (required === undefined || existsSync(join(root, directory, entry.name, required))),
	).length;
}

/** The catalog the entry READMEs advertise. */
export function catalogCounts(): { extensions: number; skills: number; themes: number } {
	return {
		extensions: countDirectories("extensions"),
		// A packaged skill is a directory with a `SKILL.md`, which is also the rule
		// `extension-load.test.ts` holds Pi's loader to.
		skills: countDirectories("skills", "SKILL.md"),
		themes: readdirSync(join(root, "themes")).filter((name) => name.endsWith(".json")).length,
	};
}

/** The names a factory registers for the host to hold, minus the path tools it replaces. */
export async function registeredSurface(entry: string): Promise<{ tools: string[]; commands: string[] }> {
	const module = (await import(join(root, entry))) as { default?: (pi: unknown) => void };
	return await withAgentDir(async () =>
		withEnv({ [ENV_DISABLED_EXTENSIONS]: "" }, () => {
			const fake = createFakePi();
			module.default?.(fake.pi);
			// Pi's own path tools are re-registered by `worktree` to follow the active
			// root; they replace the model's tool rather than joining the surface.
			const overridden = new Set<string>(ROOT_TOOL_NAMES);
			return {
				tools: [...fake.tools.keys()].filter((name) => !overridden.has(name)),
				commands: [...fake.commands.keys()],
			};
		}),
	);
}
