/**
 * Skill metadata for the panel.
 *
 * One `loadSkills` call reads every resolved `SKILL.md` and hands back the
 * declared name, description, and model-invocation flag, keyed by file path so
 * the row model can join it. Pi's loader also reports why it refused a file, and
 * that reason travels with the row so the screen can say `not loaded` instead of
 * silently showing a name. Nothing here renders or writes; the panel reads the
 * index when the Skills section first becomes visible.
 */

import { loadSkills } from "@earendil-works/pi-coding-agent";
import type { Discovery } from "../picker/types.ts";
import type { SkillInfo } from "./types.ts";

/** Loaded skill metadata keyed by the resolved resource path. */
export type SkillIndex = ReadonlyMap<string, SkillInfo>;

/** Every skill file either discovery view resolves, once, for the loader. */
export function resolvedSkillPaths(discovery: Discovery): string[] {
	const paths = [...discovery.skills.global, ...discovery.skills.effective].map((item) => item.path);
	return [...new Set(paths)];
}

/**
 * Read the metadata for every resolved skill path. A path may be a `SKILL.md`
 * or a standalone Markdown skill; both are what the resolver hands the panel.
 *
 * A diagnostic names the file Pi refused, so it becomes that row's `problem`. A
 * warning about a file that still loaded is dropped: the row's own name and
 * description already come from the same loader, and `not loaded` would be a
 * lie about a skill the model can use.
 */
export function loadSkillIndex(paths: readonly string[], cwd: string, agentDir: string): SkillIndex {
	if (paths.length === 0) return new Map();
	const { skills, diagnostics } = loadSkills({ cwd, agentDir, skillPaths: [...paths], includeDefaults: false });
	const index = new Map<string, SkillInfo>();
	for (const skill of skills) {
		index.set(skill.filePath, {
			name: skill.name,
			description: skill.description,
			modelHidden: skill.disableModelInvocation,
		});
	}
	for (const diagnostic of diagnostics) {
		const path = diagnostic.path;
		if (path === undefined || index.has(path)) continue;
		index.set(path, { description: "", modelHidden: false, problem: diagnostic.message });
	}
	return index;
}
