import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	BUILTIN_AGENTS,
	discoverAgents,
	findNearestProjectAgentsDir,
	formatAgentList,
	getAgent,
	listAgents,
	loadAgentsFromDir,
} from "./agents.ts";
import { useEnv } from "../../test/helpers/env.ts";

const tempDirs: string[] = [];

/** A unique temp directory, removed after each test. */
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-agents-test-"));
	tempDirs.push(dir);
	return dir;
}

/** Write one markdown agent file and return its path. */
function writeAgent(dir: string, file: string, frontmatter: string, body = "You are test."): string {
	mkdirSync(dir, { recursive: true });
	const filePath = join(dir, file);
	writeFileSync(filePath, `---\n${frontmatter}\n---\n${body}\n`, "utf-8");
	return filePath;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("built-in agents", () => {
	test("ships the eight built-ins in order", () => {
		expect(BUILTIN_AGENTS.map((agent) => agent.name)).toEqual([
			"explorer",
			"planner",
			"reviewer",
			"worker",
			"researcher",
			"tester",
			"debugger",
			"documenter",
		]);
		expect(listAgents()).toHaveLength(8);
	});

	test("every built-in has a description, system prompt, and builtin source", () => {
		for (const agent of BUILTIN_AGENTS) {
			expect(agent.description.length).toBeGreaterThan(0);
			expect(agent.systemPrompt.length).toBeGreaterThan(0);
			expect(agent.source).toBe("builtin");
			expect(agent.model).toBeUndefined();
		}
	});

	test("agents use explicit allowlists, with recon and planning free of bash", () => {
		expect(getAgent("explorer")?.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(getAgent("planner")?.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(getAgent("reviewer")?.tools).toContain("bash");
		// worker is scoped so it cannot recurse into `subagent` or pick up ambient tools
		expect(getAgent("worker")?.tools).toEqual(["read", "write", "edit", "bash", "grep", "find", "ls"]);
		expect(getAgent("worker")?.tools).not.toContain("subagent");
	});

	test("the new agents have the tools their role needs", () => {
		expect(getAgent("researcher")?.tools).toContain("web_search");
		expect(getAgent("researcher")?.tools).toContain("web_fetch");
		expect(getAgent("tester")?.tools).toContain("write");
		expect(getAgent("tester")?.tools).toContain("edit");
		expect(getAgent("tester")?.tools).toContain("bash");
		expect(getAgent("documenter")?.tools).toContain("write");
		expect(getAgent("documenter")?.tools).toContain("edit");
		// The debugger diagnoses; it should not be given write/edit.
		expect(getAgent("debugger")?.tools).not.toContain("write");
		expect(getAgent("debugger")?.tools).not.toContain("edit");
	});

	test("looks up agents by name", () => {
		expect(getAgent("planner")?.name).toBe("planner");
		expect(getAgent("researcher")?.name).toBe("researcher");
		expect(getAgent("missing")).toBeUndefined();
	});

	test("formats a pool for error messages with its sources", () => {
		const list = formatAgentList(BUILTIN_AGENTS);
		for (const agent of BUILTIN_AGENTS) expect(list).toContain(agent.name);
		expect(list).toContain("explorer (builtin)");
		expect(formatAgentList([])).toBe("none");
	});
});

describe("loadAgentsFromDir", () => {
	test("parses frontmatter, body, and a comma-separated tool list", () => {
		const dir = tempDir();
		writeAgent(
			dir,
			"custom.md",
			"name: custom\ndescription: A custom agent\ntools: read, bash\nmodel: anthropic/claude",
			"You are custom.",
		);

		const agents = loadAgentsFromDir(dir, "user");
		expect(agents).toHaveLength(1);
		expect(agents[0]).toMatchObject({
			name: "custom",
			description: "A custom agent",
			tools: ["read", "bash"],
			model: "anthropic/claude",
			source: "user",
		});
		expect(agents[0].systemPrompt.trim()).toBe("You are custom.");
	});

	test("parses a YAML array tool list", () => {
		const dir = tempDir();
		writeAgent(dir, "arr.md", "name: arr\ndescription: Array tools\ntools: [read, grep, find]");
		expect(loadAgentsFromDir(dir, "project")[0].tools).toEqual(["read", "grep", "find"]);
	});

	test("skips files without name or description, and non-markdown files", () => {
		const dir = tempDir();
		writeAgent(dir, "missing-name.md", "description: no name");
		writeAgent(dir, "missing-desc.md", "name: nod");
		writeFileSync(join(dir, "notes.txt"), "not an agent", "utf-8");
		expect(loadAgentsFromDir(dir, "user")).toHaveLength(0);
	});

	test("returns nothing for a missing directory", () => {
		expect(loadAgentsFromDir(join(tempDir(), "nope"), "user")).toEqual([]);
	});
});

describe("findNearestProjectAgentsDir", () => {
	test("walks up to the nearest .pi/agents", () => {
		const root = tempDir();
		const projectAgents = join(root, ".pi", "agents");
		mkdirSync(projectAgents, { recursive: true });
		const nested = join(root, "src", "deep");
		mkdirSync(nested, { recursive: true });
		expect(findNearestProjectAgentsDir(nested)).toBe(projectAgents);
	});

	test("returns null when no .pi/agents exists", () => {
		// A bare temp dir under tmpdir has no .pi/agents ancestor.
		expect(findNearestProjectAgentsDir(tempDir())).toBeNull();
	});
});

describe("discoverAgents", () => {
	test("merges built-ins, user, and project agents with project winning collisions", () => {
		const root = tempDir();
		const userDir = join(root, "user-agents");
		const projectDir = join(root, "project", ".pi", "agents");
		writeAgent(userDir, "mine.md", "name: mine\ndescription: A user agent");
		writeAgent(userDir, "reviewer.md", "name: reviewer\ndescription: User reviewer");
		writeAgent(projectDir, "reviewer.md", "name: reviewer\ndescription: Project reviewer");

		const { agents, projectAgentsDir } = discoverAgents(join(root, "project"), "both", userDir);
		const byName = new Map(agents.map((agent) => [agent.name, agent]));

		expect(projectAgentsDir).toBe(projectDir);
		expect(byName.get("explorer")?.source).toBe("builtin");
		expect(byName.get("mine")?.source).toBe("user");
		// project overrides user overrides built-in
		expect(byName.get("reviewer")?.source).toBe("project");
		expect(byName.get("reviewer")?.description).toBe("Project reviewer");
		// built-ins plus the one new external file (`reviewer` overrides by name)
		expect(agents).toHaveLength(BUILTIN_AGENTS.length + 1);
	});

	test("discovers user agents from the real agent dir (PI_CODING_AGENT_DIR)", () => {
		const agentDir = tempDir();
		writeAgent(join(agentDir, "agents"), "real.md", "name: realprobe\ndescription: From the real agent dir");
		// The preload restores PI_CODING_AGENT_DIR after the test.
		useEnv({ PI_CODING_AGENT_DIR: agentDir });

		// No injected userDir: this exercises the default `getAgentDir()` wiring.
		const names = discoverAgents(tempDir(), "user").agents.map((agent) => agent.name);
		expect(names).toContain("realprobe");
		expect(names).toContain("explorer");
	});

	test("scope 'user' excludes project agents; scope 'project' excludes user agents", () => {
		const root = tempDir();
		const userDir = join(root, "user-agents");
		const projectDir = join(root, "project", ".pi", "agents");
		writeAgent(userDir, "mine.md", "name: mine\ndescription: A user agent");
		writeAgent(projectDir, "theirs.md", "name: theirs\ndescription: A project agent");

		const userOnly = discoverAgents(join(root, "project"), "user", userDir).agents.map((a) => a.name);
		expect(userOnly).toContain("mine");
		expect(userOnly).not.toContain("theirs");

		const projectOnly = discoverAgents(join(root, "project"), "project", userDir).agents.map((a) => a.name);
		expect(projectOnly).toContain("theirs");
		expect(projectOnly).not.toContain("mine");
	});
});
