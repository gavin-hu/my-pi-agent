// Always-on prompt budget for the package's model-facing tools.
//
// Reports, per tool, the characters this package contributes to every request
// (tool `description` + parameter schema + `promptSnippet` + `promptGuidelines`)
// and enforces a ceiling so the footprint cannot silently creep back.
//
// Usage:
//   bun run scripts/prompt-budget.ts           # report only
//   bun run scripts/prompt-budget.ts --check    # non-zero exit on a violation
//
// Characters are a stable proxy for tokens; the report also prints ceil(chars/4).

import { join, resolve } from "node:path";
import { ROOT_TOOL_NAMES } from "../extensions/worktree/root-tools.ts";
import { createPackageSession, repo } from "./lib/package-session.ts";

export interface ToolPrompt {
	name: string;
	/** `description` characters. */
	description: number;
	/** Serialized parameter-schema characters. */
	params: number;
	/** `promptSnippet` characters. */
	snippet: number;
	/** Joined `promptGuidelines` characters. */
	guidelines: number;
	/** Longest single `promptGuidelines` entry. */
	maxGuideline: number;
	/** Sum of the four channels. */
	total: number;
	/** Whether the tool is in the session's active set (declared to the model). */
	active: boolean;
}

export interface Ceilings {
	/** Total characters across active tools. */
	totalActive: number;
	/** Characters for any one tool. */
	perTool: number;
	/** Characters for one `promptSnippet`. */
	snippet: number;
	/** Characters for one `promptGuidelines` entry. */
	guideline: number;
}

/**
 * Pinned ceilings. Set from the measured post-cleanup footprint with ~10%
 * headroom; raise deliberately when adding a tool or a genuinely new fact.
 */
export const PROMPT_CEILINGS: Ceilings = {
	totalActive: 15_800,
	perTool: 2_500,
	snippet: 110,
	guideline: 200,
};

interface ToolDefinition {
	description?: string;
	parameters?: unknown;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
}

/** Measure one tool definition's always-on, model-facing text. */
export function measureTool(name: string, def: ToolDefinition, active: boolean): ToolPrompt {
	const description = def.description?.length ?? 0;
	const params = JSON.stringify(def.parameters ?? {}).length;
	const snippet = def.promptSnippet?.length ?? 0;
	const list = def.promptGuidelines ?? [];
	const guidelines = list.join("").length;
	const maxGuideline = list.reduce((max, line) => Math.max(max, line.length), 0);
	return {
		name,
		description,
		params,
		snippet,
		guidelines,
		maxGuideline,
		total: description + params + snippet + guidelines,
		active,
	};
}

/** Every ceiling a tool's channels violate, as human-readable strings. */
export function checkTool(tool: ToolPrompt, ceilings: Ceilings): string[] {
	const violations: string[] = [];
	if (tool.snippet > ceilings.snippet) {
		violations.push(`${tool.name}: promptSnippet ${tool.snippet} > ${ceilings.snippet}`);
	}
	if (tool.maxGuideline > ceilings.guideline) {
		violations.push(`${tool.name}: longest guideline ${tool.maxGuideline} > ${ceilings.guideline}`);
	}
	return violations;
}

/** Every ceiling the measured set violates. */
export function checkSet(tools: readonly ToolPrompt[], ceilings: Ceilings): string[] {
	const violations: string[] = tools.flatMap((tool) => {
		const own = checkTool(tool, ceilings);
		if (tool.total > ceilings.perTool) own.push(`${tool.name}: total ${tool.total} > ${ceilings.perTool}`);
		return own;
	});
	const activeTotal = totalActive(tools);
	if (activeTotal > ceilings.totalActive) {
		violations.push(`active total ${activeTotal} > ${ceilings.totalActive}`);
	}
	return violations;
}

/** Total characters across the active tools. */
export function totalActive(tools: readonly ToolPrompt[]): number {
	return tools.filter((tool) => tool.active).reduce((sum, tool) => sum + tool.total, 0);
}

const pad = (value: string | number, width: number): string => String(value).padStart(width);
const padEnd = (value: string, width: number): string => value.padEnd(width);

/** Render the measurement table plus totals. */
export function formatReport(tools: readonly ToolPrompt[]): string {
	const header = `${padEnd("tool", 22)}${pad("desc", 7)}${pad("params", 8)}${pad("snip", 6)}${pad("guide", 7)}${pad("total", 7)}${pad("tok~", 7)}`;
	const sep = "─".repeat(header.length);
	const rows = [...tools]
		.sort((a, b) => b.total - a.total)
		.map((tool) => {
			const mark = tool.active ? " " : "*";
			return (
				`${mark}${padEnd(tool.name, 21)}` +
				pad(tool.description, 7) +
				pad(tool.params, 8) +
				pad(tool.snippet, 6) +
				pad(tool.guidelines, 7) +
				pad(tool.total, 7) +
				pad(Math.ceil(tool.total / 4), 7)
			);
		});
	const active = tools.filter((tool) => tool.active);
	const inactive = tools.filter((tool) => !tool.active);
	const activeTotal = totalActive(tools);
	const allTotal = tools.reduce((sum, tool) => sum + tool.total, 0);
	const lines = [
		header,
		sep,
		...rows,
		sep,
		`active (${active.length}):   ${activeTotal} chars  (~${Math.ceil(activeTotal / 4)} tokens)`,
		`inactive (* ${inactive.length}): ${allTotal - activeTotal} chars`,
		`all registered: ${allTotal} chars`,
	];
	return lines.join("\n");
}

/** Collect this package's tools from a live session, with their definitions. */
async function collect(): Promise<ToolPrompt[]> {
	const { session, runner, dispose } = await createPackageSession();
	try {
		const extensionsDir = join(repo, "extensions");
		// The worktree extension overrides the built-in path tools by spreading the
		// host definitions; their prose is the host's, not this package's.
		const overrides = new Set<string>(ROOT_TOOL_NAMES);
		const active = new Set(session.getActiveToolNames());
		return session
			.getAllTools()
			.filter((info) => info.sourceInfo?.path !== undefined && resolve(info.sourceInfo.path).startsWith(extensionsDir))
			.filter((info) => !overrides.has(info.name))
			.map((info) => measureTool(info.name, runner.getToolDefinition(info.name) ?? {}, active.has(info.name)));
	} finally {
		dispose();
	}
}

if (import.meta.main) {
	const tools = await collect();
	console.log(formatReport(tools));
	if (process.argv.includes("--check")) {
		const violations = checkSet(tools, PROMPT_CEILINGS);
		if (violations.length > 0) {
			console.error(`\nprompt budget exceeded:\n  ${violations.join("\n  ")}`);
			process.exit(1);
		}
		console.log("\nprompt budget ok");
	}
}
