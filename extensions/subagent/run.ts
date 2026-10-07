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
import { getAgent, formatAgentList } from "./agents.ts";
import { buildAgentArgs, getPiInvocation } from "./invocation.ts";
import { applyEvent, emptyUsage, parseJsonLine } from "./stream.ts";
import type { DispatchDefaults, OnUpdateCallback, SingleResult, SpawnFn, SubagentDetails } from "./types.ts";

export interface RunOptions {
	/** Session cwd used when the caller supplies no per-task cwd. */
	defaultCwd: string;
	/** Model/thinking inherited when the built-in agent sets none. */
	defaults: DispatchDefaults;
	agentName: string;
	task: string;
	cwd?: string;
	/** 1-based chain step, recorded on the result. */
	step?: number;
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

		const finish = (exitCode: number) => {
			if (settled) return;
			settled = true;
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
			const kill = () => {
				aborted = true;
				proc.kill("SIGTERM");
				const timer = setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000) as { unref?: () => void };
				timer.unref?.();
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
	const agent = getAgent(options.agentName);

	const result: SingleResult = {
		agent: options.agentName,
		task: options.task,
		exitCode: 1,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		step: options.step,
	};

	if (!agent) {
		result.stderr = `Unknown agent: "${options.agentName}". Available agents: ${formatAgentList()}.`;
		return result;
	}

	const emit = () => options.onUpdate?.({ content: [], details: options.makeDetails([result]) });

	let tempDir: string | null = null;
	let tempPath: string | null = null;

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tempDir = tmp.dir;
			tempPath = tmp.filePath;
		}

		const args = buildAgentArgs(agent, options.task, options.defaults, tempPath);
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
