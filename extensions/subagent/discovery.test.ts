/**
 * Project-local agents: where the walk stops, and which file wins.
 *
 * A project agent is repository-controlled, so the trust gate at the call site is only
 * meaningful while the file is inside the session's own checkout. The cases here pin the
 * boundary, the order two files claiming one name resolve in, and the frontmatter a blank
 * field must not smuggle into the roster.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import { findNearestProjectAgentsDir, loadAgentsFromDir } from "./agents.ts";

const roots: string[] = [];

/** A fresh directory tree, removed with the suite. */
function dir(...parts: string[]): string {
	const base = mkdtempSync(join(tmpdir(), "subagent-discovery-"));
	roots.push(base);
	const full = join(base, ...parts);
	mkdirSync(full, { recursive: true });
	return full;
}

afterAll(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** An agent file with the given frontmatter fields. */
function agentFile(dirPath: string, file: string, fields: string): void {
	mkdirSync(dirPath, { recursive: true });
	writeFileSync(join(dirPath, file), `---\n${fields}\n---\nYou are a test agent.\n`);
}

describe("the project-agents boundary", () => {
	test("finds the nearest .pi/agents inside the repository", () => {
		const repo = dir("repo");
		mkdirSync(join(repo, ".git"), { recursive: true });
		const nested = join(repo, "src", "deep");
		mkdirSync(nested, { recursive: true });
		agentFile(join(repo, ".pi", "agents"), "one.md", "name: one\ndescription: first");
		expect(findNearestProjectAgentsDir(nested)).toBe(join(repo, ".pi", "agents"));
	});

	test("does not adopt an agents directory above the repository", () => {
		const outer = dir("outer");
		mkdirSync(join(outer, ".git"), { recursive: true });
		agentFile(join(outer, ".pi", "agents"), "outer.md", "name: outer\ndescription: not ours");
		// A second checkout inside the outer one, with its own root and no agents of its own.
		const inner = join(outer, "repo");
		mkdirSync(join(inner, ".git"), { recursive: true });
		const nested = join(inner, "src");
		mkdirSync(nested, { recursive: true });
		expect(findNearestProjectAgentsDir(nested)).toBeNull();
	});

	test("outside a repository, the session's own directory is the boundary", () => {
		const parent = dir("plain");
		const own = join(parent, "session");
		mkdirSync(own, { recursive: true });
		agentFile(join(parent, ".pi", "agents"), "up.md", "name: up\ndescription: above the session");
		expect(findNearestProjectAgentsDir(own)).toBeNull();
		agentFile(join(own, ".pi", "agents"), "here.md", "name: here\ndescription: in the session");
		expect(findNearestProjectAgentsDir(own)).toBe(join(own, ".pi", "agents"));
	});
});

describe("what a directory loads", () => {
	test("resolves two files claiming one name the same way every time", () => {
		const agents = dir("agents");
		agentFile(agents, "b-second.md", "name: reviewer\ndescription: from b");
		agentFile(agents, "a-first.md", "name: reviewer\ndescription: from a");
		const loaded = loadAgentsFromDir(agents, "project");
		// Sorted by file name before loading, so the later file wins on every filesystem
		// rather than on whatever order `readdir` returned.
		expect(loaded.map((agent) => agent.description)).toEqual(["from a", "from b"]);
		const winner = new Map(loaded.map((agent) => [agent.name, agent.description]));
		expect(winner.get("reviewer")).toBe("from b");
	});

	test("skips a blank name or description instead of listing an uncallable agent", () => {
		const agents = dir("blank");
		agentFile(agents, "named.md", "name: keeper\ndescription: fine");
		agentFile(agents, "blank-name.md", 'name: "  "\ndescription: has a name');
		agentFile(agents, "blank-description.md", 'name: quiet\ndescription: " "');
		expect(loadAgentsFromDir(agents, "project").map((agent) => agent.name)).toEqual(["keeper"]);
	});
});
