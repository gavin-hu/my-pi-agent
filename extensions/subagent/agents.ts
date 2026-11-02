/**
 * Agent definitions and discovery.
 *
 * Built-in agents ship with the extension. User agents are loaded from
 * `<agent-dir>/agents` and project agents from the nearest
 * `<CONFIG_DIR_NAME>/agents` (for example `.pi/agents`). Each external file is
 * markdown with YAML frontmatter (`name`, `description`, `tools`, `model`) and
 * the system prompt as the body.
 *
 * Resolution merges built-ins, then user agents, then project agents, keyed by
 * name — so a later file can customize an earlier agent of the same name. An
 * agent's `model` is intentionally optional: when unset the subprocess inherits
 * the dispatching session's provider/model and thinking level.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { READ_DOC_TOOL } from "../../lib/tool-names.ts";

/** Where an agent definition came from. */
export type AgentSource = "builtin" | "user" | "project";

/** Which external agent directories to load, in addition to the built-ins. */
export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	/** Stable identifier used in tool calls. */
	name: string;
	/** One-line summary shown in the agent list and tool description. */
	description: string;
	/** Tool allowlist passed as `--tools`; omitted means inherit every default tool. */
	tools?: string[];
	/** Appended to the subprocess system prompt via `--append-system-prompt`. */
	systemPrompt: string;
	/** Optional model override; most agents leave this unset. */
	model?: string;
	/** Where the definition came from. */
	source: AgentSource;
	/** Source file for externally loaded agents. */
	filePath?: string;
}

export const BUILTIN_AGENTS: readonly AgentConfig[] = [
	{
		name: "explorer",
		description: "Fast codebase recon that returns compressed context for handoff to other agents",
		tools: ["read", "grep", "find", "ls", READ_DOC_TOOL],
		source: "builtin",
		systemPrompt: `You are an explorer. Quickly investigate a codebase and return structured findings that another agent can use without re-reading everything.

Your output will be passed to an agent who has NOT seen the files you explored.

Thoroughness (infer from task, default medium):
- Quick: Targeted lookups, key files only
- Medium: Follow imports, read critical sections
- Thorough: Trace all dependencies, check tests/types

Strategy:
1. grep/find to locate relevant code
2. Read key sections (not entire files)
3. Identify types, interfaces, key functions
4. Note dependencies between files

Output format:

## Files Retrieved
List with exact line ranges:
1. \`path/to/file.ts\` (lines 10-50) - Description of what's here
2. \`path/to/other.ts\` (lines 100-150) - Description
3. ...

## Key Code
Critical types, interfaces, or functions:

\`\`\`typescript
interface Example {
  // actual code from the files
}
\`\`\`

\`\`\`typescript
function keyFunction() {
  // actual implementation
}
\`\`\`

## Architecture
Brief explanation of how the pieces connect.

## Start Here
Which file to look at first and why.`,
	},
	{
		name: "planner",
		description:
			"Delegated implementation planning in an isolated context (headless/chain; use plan mode for interactive planning)",
		tools: ["read", "grep", "find", "ls", READ_DOC_TOOL],
		source: "builtin",
		systemPrompt: `You are a delegated planning specialist working in an isolated context. The caller hands you planning when it wants a plan produced without adding exploration to its own transcript — for example an explorer → planner → worker chain, or a headless run.

For interactive planning where the user reviews and approves the plan, the caller uses Pi's plan mode instead of you. Do not try to write plan files; return the plan as your reply.

You receive context (usually from an explorer) and requirements, then produce a clear implementation plan.

You must NOT make any changes. Only read, analyze, and plan.

Input format you'll receive:
- Context/findings from an explorer agent
- Original query or requirements

Output format:

## Goal
One sentence summary of what needs to be done.

## Plan
Numbered steps, each small and actionable:
1. Step one - specific file/function to modify
2. Step two - what to add/change
3. ...

## Files to Modify
- \`path/to/file.ts\` - what changes
- \`path/to/other.ts\` - what changes

## New Files (if any)
- \`path/to/new.ts\` - purpose

## Risks
Anything to watch out for.

Keep the plan concrete. The worker agent will execute it verbatim.`,
	},
	{
		name: "reviewer",
		description: "Code review specialist for quality and security analysis",
		tools: ["read", "grep", "find", "ls", READ_DOC_TOOL, "bash"],
		source: "builtin",
		systemPrompt: `You are a senior code reviewer. Analyze code for quality, security, and maintainability.

Bash is for read-only commands only: \`git diff\`, \`git log\`, \`git show\`, and similar inspection. Do NOT modify tracked files and do NOT run builds or tests.
Assume tool permissions are not perfectly enforceable; keep all bash usage strictly read-only.

Strategy:
1. Run \`git diff\` to see recent changes (if applicable)
2. Read the modified files
3. Check for bugs, security issues, code smells

Output format:

## Files Reviewed
- \`path/to/file.ts\` (lines X-Y)

## Critical (must fix)
- \`file.ts:42\` - Issue description

## Warnings (should fix)
- \`file.ts:100\` - Issue description

## Suggestions (consider)
- \`file.ts:150\` - Improvement idea

## Summary
Overall assessment in 2-3 sentences.

Be specific with file paths and line numbers.`,
	},
	{
		name: "worker",
		description: "General-purpose subagent with full capabilities and an isolated context window",
		tools: ["read", "write", "edit", "bash", "grep", "find", "ls", READ_DOC_TOOL],
		source: "builtin",
		systemPrompt: `You are a worker agent with full capabilities. You operate in an isolated context window to handle delegated tasks without polluting the main conversation.

Work autonomously to complete the assigned task. Use all available tools as needed.

Output format when finished:

## Completed
What was done.

## Files Changed
- \`path/to/file.ts\` - what changed

## Notes (if any)
Anything the main agent should know.

If handing off to another agent (e.g. reviewer), include:
- Exact file paths changed
- Key functions/types touched (short list)`,
	},
];

/** Raw agent frontmatter; values are `unknown` because YAML can hold anything. */
type AgentFrontmatter = {
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	model?: unknown;
};

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else yields no tools rather than throwing: this
 * runs during discovery, where one bad file must not take down the others.
 */
function normalizeTools(value: unknown): string[] | undefined {
	const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
	const tools = raw
		.filter((tool): tool is string => typeof tool === "string")
		.map((tool) => tool.trim())
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

/** Load every valid `*.md` agent from one directory. Invalid files are skipped. */
export function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	if (!fs.existsSync(dir)) return [];

	let entries: fs.Dirent[];
	try {
		// Sorted, so two files claiming one name resolve the same way on every filesystem:
		// `readdir` order is the platform's, and the pool takes the later one.
		entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}

	const agents: AgentConfig[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
			// A blank field is a missing one: `name: "  "` would list an agent nobody can call,
			// and Pi's own frontmatter reader treats a blank description the same way.
			if (typeof frontmatter.name !== "string" || frontmatter.name.trim() === "") continue;
			if (typeof frontmatter.description !== "string" || frontmatter.description.trim() === "") continue;
			agents.push({
				name: frontmatter.name,
				description: frontmatter.description,
				tools: normalizeTools(frontmatter.tools),
				model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
				systemPrompt: body,
				source,
				filePath,
			});
		} catch {
			continue;
		}
	}
	return agents;
}

function isDirectory(candidate: string): boolean {
	try {
		return fs.statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

/** Whether `dir` is a repository root: `.git` is a directory, or the file a worktree has. */
function isRepositoryRoot(dir: string): boolean {
	try {
		fs.statSync(path.join(dir, ".git"));
		return true;
	} catch {
		return false;
	}
}

/**
 * The nearest `<CONFIG_DIR_NAME>/agents` between `cwd` and its repository root.
 *
 * The walk is bounded by the repository, because only a directory inside the session's own
 * checkout is what the trust gate at the call site is about: an agent file above the root —
 * a parent checkout, `/tmp` — is not repository-controlled, and the gate would never see it.
 * Outside a repository the session's own directory is the boundary.
 */
export function findNearestProjectAgentsDir(cwd: string): string | null {
	let root: string | undefined;
	for (let current = cwd; ; current = path.dirname(current)) {
		if (isRepositoryRoot(current)) {
			root = current;
			break;
		}
		const parent = path.dirname(current);
		if (parent === current) break;
	}
	const boundary = root ?? cwd;
	for (let current = cwd; ; current = path.dirname(current)) {
		const candidate = path.join(current, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;
		if (current === boundary) return null;
	}
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

/**
 * Resolve the agent pool for one call: built-ins, then user, then project
 * agents (later wins on a name collision). `userDir` is injectable for tests.
 */
export function discoverAgents(cwd: string, scope: AgentScope, userDir?: string): AgentDiscoveryResult {
	const resolvedUserDir = userDir ?? path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const pool = new Map<string, AgentConfig>();
	for (const agent of BUILTIN_AGENTS) pool.set(agent.name, agent);
	if (scope !== "project") {
		for (const agent of loadAgentsFromDir(resolvedUserDir, "user")) pool.set(agent.name, agent);
	}
	if (scope !== "user" && projectAgentsDir) {
		for (const agent of loadAgentsFromDir(projectAgentsDir, "project")) pool.set(agent.name, agent);
	}

	return { agents: Array.from(pool.values()), projectAgentsDir };
}

/** `name (source): description; ...`, or `"none"`, for error messages. */
export function formatAgentList(agents: readonly AgentConfig[]): string {
	if (agents.length === 0) return "none";
	return agents.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; ");
}

/**
 * Comma-separated agent names, or `"none"`, for the model-facing tool
 * description.
 *
 * Names only: the names are self-evident (explorer, planner, reviewer…), and the
 * full descriptions are available from {@link discoverAgents}, so they are not
 * repeated in always-on context on every request.
 */
export function formatAgentNames(agents: readonly AgentConfig[]): string {
	if (agents.length === 0) return "none";
	return agents.map((agent) => agent.name).join(", ");
}
