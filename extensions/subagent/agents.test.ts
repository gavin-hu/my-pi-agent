import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	BUILTIN_AGENTS,
	discoverAgents,
	findNearestProjectAgentsDir,
	formatAgentList,
	formatAgentNames,
	loadAgentsFromDir,
} from "./agents.ts";
import { finishedEvent } from "./accounting.ts";
import { DEFAULT_SUBAGENT_CONFIG, loadSubagentConfig, normalizeSubagentConfig } from "./config.ts";
import { buildAgentArgs, getPiInvocation } from "./invocation.ts";
import { MAX_CHAIN_STEPS, MAX_PARALLEL_TASKS, resolveMode, SubagentParams } from "./schema.ts";
import { emptyUsage } from "./stream.ts";
import type { SingleResult } from "./types.ts";
import { tempDir as makeTempDir, withAgentDir } from "../../test/helpers/env.ts";

/** Look up a built-in agent for assertions about a named role. */
const builtin = (name: string) => BUILTIN_AGENTS.find((agent) => agent.name === name);

const tempDirs: string[] = [];

/** A unique temp directory, removed after each test. */
function tempDir(): string {
	const dir = makeTempDir("pi-agents-test-");
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

/** A completed run with one assistant turn, for the accounting contract. */
function result(over: Partial<SingleResult> = {}): SingleResult {
	return {
		agent: "explorer",
		task: "look",
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { ...emptyUsage(), input: 1000, output: 200, cacheRead: 50, cacheWrite: 10, cost: 0.02, turns: 1 },
		provider: "anthropic",
		model: "opus-4.5",
		finishedAt: 1_700_000_000_000,
		...over,
	};
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("built-in agents", () => {
	test("ships the eight role agents in order", () => {
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
	});

	test("every built-in carries a prompt, a description, and an explicit allowlist", () => {
		const expectedTools: Record<string, string[]> = {
			explorer: ["read", "grep", "find", "ls"],
			planner: ["read", "grep", "find", "ls"],
			reviewer: ["read", "grep", "find", "ls", "bash"],
			worker: ["read", "write", "edit", "bash", "grep", "find", "ls"],
			researcher: ["read", "grep", "find", "ls", "web_search", "web_fetch"],
			tester: ["read", "write", "edit", "grep", "find", "ls", "bash"],
			debugger: ["read", "grep", "find", "ls", "bash"],
			documenter: ["read", "write", "edit", "grep", "find", "ls", "bash"],
		};

		for (const agent of BUILTIN_AGENTS) {
			expect(agent.source, agent.name).toBe("builtin");
			expect(agent.description.length, agent.name).toBeGreaterThan(0);
			expect(agent.systemPrompt.trim().length, agent.name).toBeGreaterThan(0);
			expect(agent.tools, agent.name).toEqual(expectedTools[agent.name]);
			expect(agent.model, agent.name).toBeUndefined();
		}
	});

	test("no built-in can recurse into the subagent tool", () => {
		for (const agent of BUILTIN_AGENTS) expect(agent.tools).not.toContain("subagent");
	});

	test("formats a pool for error messages with its sources", () => {
		const list = formatAgentList(BUILTIN_AGENTS);
		for (const agent of BUILTIN_AGENTS) expect(list).toContain(agent.name);
		expect(list).toContain("explorer (builtin)");
		expect(formatAgentList([])).toBe("none");
	});

	test("formats the model roster as names only", () => {
		const names = formatAgentNames(BUILTIN_AGENTS);
		for (const agent of BUILTIN_AGENTS) expect(names).toContain(agent.name);
		expect(names).not.toContain(BUILTIN_AGENTS[0]!.description);
		expect(formatAgentNames([])).toBe("none");
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

	test("treats an empty or unusable tool list as inheritance", () => {
		const dir = tempDir();
		writeAgent(dir, "blank.md", "name: blank\ndescription: Blank tools\ntools:");
		writeAgent(dir, "object.md", "name: object\ndescription: Object tools\ntools:\n  read: yes");

		const byName = new Map(loadAgentsFromDir(dir, "user").map((agent) => [agent.name, agent]));
		expect(byName.get("blank")?.tools).toBeUndefined();
		expect(byName.get("object")?.tools).toBeUndefined();
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

	test("discovers user agents from the real agent dir (PI_CODING_AGENT_DIR)", async () => {
		await withAgentDir((agentDir) => {
			writeAgent(join(agentDir, "agents"), "real.md", "name: realprobe\ndescription: From the real agent dir");

			// No injected userDir: this exercises the default `getAgentDir()` wiring.
			const names = discoverAgents(tempDir(), "user").agents.map((agent) => agent.name);
			expect(names).toContain("realprobe");
			expect(names).toContain("explorer");
		});
	});

	test("scope 'user' excludes project agents; scope 'project' excludes user agents", () => {
		const root = tempDir();
		const userDir = join(root, "user-agents");
		const projectDir = join(root, "project", ".pi", "agents");
		writeAgent(userDir, "mine.md", "name: mine\ndescription: A user agent");
		writeAgent(projectDir, "theirs.md", "name: theirs\ndescription: A project agent");

		const userOnly = discoverAgents(join(root, "project"), "user", userDir).agents.map((agent) => agent.name);
		expect(userOnly).toContain("mine");
		expect(userOnly).not.toContain("theirs");

		const projectOnly = discoverAgents(join(root, "project"), "project", userDir).agents.map((agent) => agent.name);
		expect(projectOnly).toContain("theirs");
		expect(projectOnly).not.toContain("mine");
	});
});

describe("normalizeSubagentConfig", () => {
	test("returns the base for missing input", () => {
		expect(normalizeSubagentConfig(undefined, DEFAULT_SUBAGENT_CONFIG)).toEqual(DEFAULT_SUBAGENT_CONFIG);
	});

	test("clamps the deadline to its bounds", () => {
		expect(normalizeSubagentConfig({ timeoutMs: 5_000 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(5_000);
		expect(normalizeSubagentConfig({ timeoutMs: 0 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(0);
		expect(normalizeSubagentConfig({ timeoutMs: -1 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(0);
		expect(normalizeSubagentConfig({ timeoutMs: 9_999_999 }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(3_600_000);
		expect(normalizeSubagentConfig({ timeoutMs: "soon" }, DEFAULT_SUBAGENT_CONFIG).timeoutMs).toBe(
			DEFAULT_SUBAGENT_CONFIG.timeoutMs,
		);
	});

	test("only a known transcript mode is accepted", () => {
		expect(normalizeSubagentConfig({ transcripts: "failed" }, DEFAULT_SUBAGENT_CONFIG).transcripts).toBe("failed");
		expect(normalizeSubagentConfig({ transcripts: "all" }, DEFAULT_SUBAGENT_CONFIG).transcripts).toBe("all");
		expect(
			normalizeSubagentConfig({ transcripts: "everything" as unknown as "all" }, DEFAULT_SUBAGENT_CONFIG).transcripts,
		).toBe(DEFAULT_SUBAGENT_CONFIG.transcripts);
		expect(normalizeSubagentConfig({ transcripts: 1 as unknown as "all" }, DEFAULT_SUBAGENT_CONFIG).transcripts).toBe(
			DEFAULT_SUBAGENT_CONFIG.transcripts,
		);
	});

	test("clamps the background capacity", () => {
		expect(normalizeSubagentConfig({ backgroundMax: 2 }, DEFAULT_SUBAGENT_CONFIG).backgroundMax).toBe(2);
		expect(normalizeSubagentConfig({ backgroundMax: 0 }, DEFAULT_SUBAGENT_CONFIG).backgroundMax).toBe(1);
		expect(normalizeSubagentConfig({ backgroundMax: 99 }, DEFAULT_SUBAGENT_CONFIG).backgroundMax).toBe(8);
	});

	test("keeps retention usable", () => {
		expect(normalizeSubagentConfig({ retentionDays: 3 }, DEFAULT_SUBAGENT_CONFIG).retentionDays).toBe(3);
		expect(normalizeSubagentConfig({ retentionDays: 0 }, DEFAULT_SUBAGENT_CONFIG).retentionDays).toBe(1);
		expect(normalizeSubagentConfig({ maxRuns: 0 }, DEFAULT_SUBAGENT_CONFIG).maxRuns).toBe(1);
		expect(normalizeSubagentConfig({ maxRuns: 5_000 }, DEFAULT_SUBAGENT_CONFIG).maxRuns).toBe(1_000);
	});
});

describe("loadSubagentConfig", () => {
	test("returns the defaults when no files exist", async () => {
		await withAgentDir(() => {
			expect(loadSubagentConfig(tempDir())).toEqual(DEFAULT_SUBAGENT_CONFIG);
		}, "subagent-global-");
	});

	test("merges global then project, with project winning", async () => {
		const repo = tempDir();
		mkdirSync(join(repo, ".pi"), { recursive: true });
		writeFileSync(join(repo, ".pi", "bytefly.json"), JSON.stringify({ subagent: { timeoutMs: 1_000 } }));

		await withAgentDir((globalDir) => {
			writeFileSync(
				join(globalDir, "bytefly.json"),
				JSON.stringify({ subagent: { timeoutMs: 2_000, transcripts: "all" } }),
			);
			const config = loadSubagentConfig(repo);
			expect(config.timeoutMs).toBe(1_000);
			expect(config.transcripts).toBe("all");
		}, "subagent-global-");
	});

	test("ignores malformed files", async () => {
		await withAgentDir((globalDir) => {
			writeFileSync(join(globalDir, "bytefly.json"), "{ not json");
			expect(loadSubagentConfig(tempDir())).toEqual(DEFAULT_SUBAGENT_CONFIG);
		}, "subagent-global-");
	});
});

describe("SubagentParams", () => {
	test("declares the readOnly parameter plan mode relies on", () => {
		// Plan mode's capability probe reads this property name; renaming it here
		// must break the probe's test, not silently disable read-only delegation.
		expect(Object.prototype.hasOwnProperty.call(SubagentParams.properties, "readOnly")).toBe(true);
	});
});

describe("resolveMode", () => {
	const task = (agent: string) => ({ agent, task: "do a thing" });

	test("detects single mode from agent + task", () => {
		expect(resolveMode({ agent: "explorer", task: "find it" })).toEqual({ mode: "single" });
	});

	test("detects parallel mode from tasks", () => {
		expect(resolveMode({ tasks: [task("explorer"), task("planner")] })).toEqual({ mode: "parallel" });
	});

	test("detects chain mode from chain", () => {
		expect(resolveMode({ chain: [task("explorer"), task("planner")] })).toEqual({ mode: "chain" });
	});

	test("rejects an empty call", () => {
		const result = resolveMode({});
		expect("error" in result && result.error).toContain("Provide one mode");
	});

	test("rejects mixing chain with tasks", () => {
		const result = resolveMode({ chain: [task("explorer")], tasks: [task("planner")] });
		expect("error" in result && result.error).toContain("not both");
	});

	test("rejects mixing a single agent with tasks", () => {
		const result = resolveMode({ agent: "explorer", task: "x", tasks: [task("planner")] });
		expect("error" in result && result.error).toContain("not both");
	});

	test("rejects an agent without a task", () => {
		const result = resolveMode({ agent: "explorer" });
		expect("error" in result).toBe(true);
	});

	test("accepts background only with a single agent and task", () => {
		expect(resolveMode({ agent: "explorer", task: "find it", background: true })).toEqual({ mode: "single" });
		expect("error" in resolveMode({ tasks: [task("explorer")], background: true })).toBe(true);
		expect("error" in resolveMode({ chain: [task("explorer")], background: true })).toBe(true);
		expect("error" in resolveMode({ agent: "explorer", background: true })).toBe(true);
	});

	test("enforces the parallel task cap even when schema validation is bypassed", () => {
		const tooMany = new Array(MAX_PARALLEL_TASKS + 1).fill(null).map(() => task("explorer"));
		const rejected = resolveMode({ tasks: tooMany });
		expect("error" in rejected && rejected.error).toContain(`Max is ${MAX_PARALLEL_TASKS}`);

		const atCap = new Array(MAX_PARALLEL_TASKS).fill(null).map(() => task("explorer"));
		expect(resolveMode({ tasks: atCap })).toEqual({ mode: "parallel" });
	});

	test("enforces the chain step cap even when schema validation is bypassed", () => {
		const tooMany = new Array(MAX_CHAIN_STEPS + 1).fill(null).map(() => task("explorer"));
		const rejected = resolveMode({ chain: tooMany });
		expect("error" in rejected && rejected.error).toContain(`Max is ${MAX_CHAIN_STEPS}`);

		const atCap = new Array(MAX_CHAIN_STEPS).fill(null).map(() => task("explorer"));
		expect(resolveMode({ chain: atCap })).toEqual({ mode: "chain" });
	});
});

describe("buildAgentArgs", () => {
	const explorer = builtin("explorer")!;
	const planner = builtin("planner")!;
	const worker = builtin("worker")!;

	function valueAfter(args: string[], flag: string): string | undefined {
		const index = args.indexOf(flag);
		return index === -1 ? undefined : args[index + 1];
	}

	test("always runs json, print, no-session, with the task last", () => {
		const args = buildAgentArgs(planner, "plan it", {}, null);
		expect(args.slice(0, 4)).toEqual(["--mode", "json", "-p", "--no-session"]);
		expect(args.at(-1)).toBe("Task: plan it");
	});

	test("inherits the dispatch model and thinking level", () => {
		const args = buildAgentArgs(planner, "t", { model: "anthropic/claude", thinkingLevel: "high" }, null);
		expect(valueAfter(args, "--model")).toBe("anthropic/claude");
		expect(valueAfter(args, "--thinking")).toBe("high");
	});

	test("an agent model overrides the dispatch model and suppresses thinking", () => {
		const pinned = { ...planner, model: "openai/gpt" };
		const args = buildAgentArgs(pinned, "t", { model: "anthropic/claude", thinkingLevel: "high" }, null);
		expect(valueAfter(args, "--model")).toBe("openai/gpt");
		expect(args).not.toContain("--thinking");
	});

	test("passes the tool allowlist and the appended system prompt", () => {
		const args = buildAgentArgs(explorer, "t", {}, "/tmp/prompt.md");
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls");
		expect(valueAfter(args, "--append-system-prompt")).toBe("/tmp/prompt.md");
	});

	test("passes the researcher's web tool allowlist", () => {
		const researcher = builtin("researcher")!;
		const args = buildAgentArgs(researcher, "t", {}, null);
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls,web_search,web_fetch");
	});

	test("readOnly narrows an agent's tools to the reader allowlist", () => {
		const args = buildAgentArgs(worker, "t", {}, null, true);
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls");
	});

	test("readOnly forces the reader allowlist for an agent with no tools", () => {
		const inherit = { ...worker, tools: undefined };
		const args = buildAgentArgs(inherit, "t", {}, null, true);
		expect(valueAfter(args, "--tools")).toBe("read,grep,find,ls,web_search,web_fetch");
	});

	test("readOnly never passes a writing or shell tool", () => {
		const tools = valueAfter(buildAgentArgs(worker, "t", {}, null, true), "--tools")!.split(",");
		for (const denied of ["write", "edit", "bash", "powershell", "subagent"]) {
			expect(tools).not.toContain(denied);
		}
	});

	test("omits --tools for an agent with no allowlist", () => {
		const inherit = { ...worker, tools: undefined };
		const args = buildAgentArgs(inherit, "t", {}, null);
		expect(args).not.toContain("--tools");
		expect(args).not.toContain("--append-system-prompt");
	});
});

describe("getPiInvocation", () => {
	test("returns a command and preserves the supplied arguments", () => {
		const invocation = getPiInvocation(["--mode", "json", "Task: hi"]);
		expect(invocation.command.length).toBeGreaterThan(0);
		expect(invocation.args.at(-1)).toBe("Task: hi");
	});
});

describe("finishedEvent", () => {
	test("carries the child's pricing inputs and finish time", () => {
		expect(finishedEvent(result())).toEqual({
			agent: "explorer",
			provider: "anthropic",
			model: "opus-4.5",
			input: 1000,
			output: 200,
			cacheRead: 50,
			cacheWrite: 10,
			recordedCost: 0.02,
			at: 1_700_000_000_000,
			exitCode: 0,
		});
	});

	test("reports a run with no usage as nothing to account for", () => {
		expect(finishedEvent(result({ usage: emptyUsage() }))).toBeNull();
	});

	test("keeps an unknown provider or model null rather than guessing", () => {
		const event = finishedEvent(result({ provider: undefined, model: undefined, finishedAt: undefined }));
		expect(event).toMatchObject({ provider: null, model: null, at: null });
	});

	test("still reports a failed run that spent tokens", () => {
		const event = finishedEvent(result({ exitCode: 1, stopReason: "error" }));
		expect(event?.exitCode).toBe(1);
		expect(event?.input).toBe(1000);
	});
});
