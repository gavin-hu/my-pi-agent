/**
 * The bytefly Skills capability: reading a resolved skill's `SKILL.md` through
 * Pi's loader, joining it to the picker's rows, and the paths the screen reads.
 *
 * The loader tests write real `SKILL.md` files into a temp directory so the
 * frontmatter rules are Pi's, not a reimplementation; the rest is pure.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildSkillModel } from "./join.ts";
import { loadSkillIndex, resolvedSkillPaths } from "./skills.ts";
import { makeDiscovery, makeItem, skillItem } from "../../../test/helpers/fixtures/picker.ts";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** Write one `SKILL.md` under a fresh agent directory and return its path. */
function writeSkill(name: string, text: string): { root: string; path: string } {
	const root = temps.track(tempDir(`bytefly-skill-${name}-`));
	const dir = join(root, "skills", name);
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "SKILL.md");
	writeFileSync(path, text);
	return { root, path };
}

/** Write one standalone Markdown skill (a file, not a folder) in the skills root. */
function writeFlatSkill(file: string, text: string): { root: string; path: string } {
	const root = temps.track(tempDir(`bytefly-skill-${file}-`));
	const dir = join(root, "skills");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, file);
	writeFileSync(path, text);
	return { root, path };
}

const FRONTMATTER = (fields: string): string => `---\n${fields}\n---\n\n# A skill\n`;

describe("loadSkillIndex", () => {
	test("reads the declared name, description, and model-invocation flag", () => {
		const skill = writeSkill(
			"pdf-tools",
			FRONTMATTER("name: pdf-tools\ndescription: Extract text from PDF files.\ndisable-model-invocation: true"),
		);

		const index = loadSkillIndex([skill.path], skill.root, skill.root);

		expect(index.get(skill.path)).toEqual({
			name: "pdf-tools",
			description: "Extract text from PDF files.",
			modelHidden: true,
		});
	});

	test("falls back to the folder name when the frontmatter omits one", () => {
		const skill = writeSkill("review", FRONTMATTER("description: Review a diff."));

		const index = loadSkillIndex([skill.path], skill.root, skill.root);

		expect(index.get(skill.path)?.name).toBe("review");
		expect(index.get(skill.path)?.modelHidden).toBe(false);
	});

	test("carries the reason Pi refused a file, with no name to show", () => {
		const skill = writeSkill("broken", FRONTMATTER("name: broken"));

		const index = loadSkillIndex([skill.path], skill.root, skill.root);

		expect(index.get(skill.path)?.name).toBeUndefined();
		expect(index.get(skill.path)?.problem).toContain("description");
	});

	test("names a standalone Markdown skill the way Pi does", () => {
		const skill = writeFlatSkill("standalone.md", FRONTMATTER("description: A single file."));

		const index = loadSkillIndex([skill.path], skill.root, skill.root);

		// Pi falls back to the parent directory for a standalone file, not the file
		// stem; the panel shows the name the model and `/skill:<name>` use, and the
		// detail pane carries the path that disambiguates it.
		expect(index.get(skill.path)?.name).toBe("skills");
		expect(index.get(skill.path)?.description).toBe("A single file.");
	});

	test("returns an empty index for no paths without touching the disk", () => {
		expect(loadSkillIndex([], "/does/not/exist", "/does/not/exist").size).toBe(0);
	});
});

describe("skill rows", () => {
	test("labels a row by the declared name and keeps the path label otherwise", () => {
		const listed = skillItem("pdf-tools");
		const refused = skillItem("broken");
		const index = new Map([
			[listed.path, { name: "PDF tools", description: "Extract text.", modelHidden: false }],
			[refused.path, { description: "", modelHidden: false, problem: "missing description" }],
		]);

		const model = buildSkillModel({ items: [listed, refused], index, agentDir: "/agent" });

		expect(model.rows.map((row) => row.label)).toEqual(["broken", "PDF tools"]);
		expect(model.rows[0]?.skill?.problem).toBe("missing description");
		expect(model.rows[1]?.item).toBe(listed);
	});

	test("groups skill rows by source, packages first", () => {
		const packaged = makeItem({
			path: "/pkg/skills/alpha/SKILL.md",
			metadata: { source: "npm:pkg", origin: "package", scope: "user", baseDir: "/pkg" },
		});
		const model = buildSkillModel({
			items: [skillItem("zulu"), packaged],
			index: new Map(),
			agentDir: "/agent",
		});

		expect(model.groups.map((group) => group.label)).toEqual(["npm:pkg (user)", "User (/agent/)"]);
		expect(model.rows.map((row) => row.label)).toEqual(["alpha", "zulu"]);
	});
});

describe("resolvedSkillPaths", () => {
	test("reads both views once, in discovery order", () => {
		const shared = skillItem("shared");
		const project = skillItem("project");
		const { discovery } = makeDiscovery({ skills: [shared], effectiveSkills: [shared, project] });

		expect(resolvedSkillPaths(discovery)).toEqual([shared.path, project.path]);
	});

	test("is empty when neither view resolves a skill", () => {
		expect(resolvedSkillPaths(makeDiscovery().discovery)).toEqual([]);
	});
});
