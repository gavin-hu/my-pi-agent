/**
 * Running one subagent subprocess.
 *
 * Spawns `pi --mode json`, folds the JSON event stream into a `SingleResult`,
 * streams partial updates, and cleans up the temporary system-prompt file. The
 * process factory is injectable so tests can drive a scripted child.
 */

import { spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { BUILTIN_AGENTS, formatAgentList, type AgentConfig } from "./agents.ts";
import { buildAgentArgs, getPiInvocation, READ_ONLY_NOTE } from "./invocation.ts";
import { applyEvent, createResult, parseJsonLine } from "./stream.ts";
import type { DispatchDefaults, OnUpdateCallback, SingleResult, SpawnFn, SubagentDetails } from "./types.ts";

export interface RunOptions {
	/** Session cwd used when the caller supplies no per-task cwd. */
	defaultCwd: string;
	/** Model/thinking inherited when the built-in agent sets none. */
	defaults: DispatchDefaults;
	agentName: string;
	task: string;
	/** Original chain step task, before `{previous}` substitution; display only. */
	taskTemplate?: string;
	cwd?: string;
	/** Resolved agent pool; defaults to the built-ins when omitted. */
	agents?: readonly AgentConfig[];
	/** 1-based chain step, recorded on the result. */
	step?: number;
	/** Force the child to a read-only tool set (plan mode). */
	readOnly?: boolean;
	signal?: AbortSignal;
	onUpdate?: OnUpdateCallback;
	/** Builds the details payload for this mode from the current results. */
	makeDetails: (results: SingleResult[]) => SubagentDetails;
	/** Process factory; defaults to `node:child_process.spawn`. */
	spawn?: SpawnFn;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(dir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir, filePath };
}

interface SpawnOutcome {
	exitCode: number;
	aborted: boolean;
}

/** Spawn the child, parse stdout line-by-line, and resolve when it closes. */
function spawnAndCollect(
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined,
	result: SingleResult,
	onEvent: () => void,
	spawn: SpawnFn,
): Promise<SpawnOutcome> {
	return new Promise<SpawnOutcome>((resolve) => {
		const proc = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let buffer = "";
		let settled = false;
		let aborted = false;

		let kill: (() => void) | undefined;
		let killTimer: ReturnType<typeof setTimeout> | undefined;

		const finish = (exitCode: number) => {
			if (settled) return;
			settled = true;
			if (kill && signal) signal.removeEventListener("abort", kill);
			if (killTimer) clearTimeout(killTimer);
			if (buffer.trim()) {
				const event = parseJsonLine(buffer);
				if (event && applyEvent(result, event)) onEvent();
			}
			resolve({ exitCode, aborted });
		};

		const processLine = (line: string) => {
			const event = parseJsonLine(line);
			if (event && applyEvent(result, event)) onEvent();
		};

		proc.stdout?.on("data", (chunk) => {
			buffer += chunk.toString();
			// Keep the final partial line in the buffer for the close handler.
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				processLine(buffer.slice(0, newline));
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
			}
		});

		proc.stderr?.on("data", (chunk) => {
			result.stderr += chunk.toString();
		});

		proc.on("close", (code) => finish(code ?? 0));
		proc.on("error", () => finish(1));

		if (signal) {
			kill = () => {
				aborted = true;
				proc.kill("SIGTERM");
				killTimer = setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
				killTimer.unref();
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});
}

/**
 * Run one subagent to completion.
 *
 * Never throws for a missing agent or a failing subprocess; those come back as
 * a `SingleResult` with a non-zero exit code. Throws only when the caller
 * aborts a run that had started.
 */
export async function runSingleAgent(options: RunOptions): Promise<SingleResult> {
	const spawn = options.spawn ?? nodeSpawn;
	const pool = options.agents ?? BUILTIN_AGENTS;
	const agent = pool.find((candidate) => candidate.name === options.agentName);

	const result = createResult(options.agentName, options.task, {
		agentSource: agent?.source ?? "unknown",
		taskTemplate: options.taskTemplate,
		step: options.step,
		startedAt: Date.now(),
	});

	if (!agent) {
		result.exitCode = 1;
		result.stderr = `Unknown agent: "${options.agentName}". Available agents: ${formatAgentList(pool)}.`;
		return result;
	}

	const emit = () => options.onUpdate?.({ content: [], details: options.makeDetails([result]) });

	let tempDir: string | null = null;
	let tempPath: string | null = null;

	try {
		const systemPrompt = options.readOnly
			? [agent.systemPrompt, READ_ONLY_NOTE].filter(Boolean).join("\n\n")
			: agent.systemPrompt;
		if (systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, systemPrompt);
			tempDir = tmp.dir;
			tempPath = tmp.filePath;
		}

		const args = buildAgentArgs(agent, options.task, options.defaults, tempPath, options.readOnly === true);
		const invocation = getPiInvocation(args);
		const outcome = await spawnAndCollect(
			invocation.command,
			invocation.args,
			options.cwd ?? options.defaultCwd,
			options.signal,
			result,
			emit,
			spawn,
		);

		result.exitCode = outcome.exitCode;
		result.finishedAt = Date.now();
		if (outcome.aborted) throw new Error("Subagent was aborted");
		return result;
	} finally {
		if (tempPath) {
			try {
				fs.unlinkSync(tempPath);
			} catch {
				/* ignore */
			}
		}
		if (tempDir) {
			try {
				fs.rmdirSync(tempDir);
			} catch {
				/* ignore */
			}
		}
	}
}
