import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { runSingleAgent, type RunOptions } from "../../extensions/subagent/run.ts";
import { getFinalOutput, getResultOutput, isFailedResult } from "../../extensions/subagent/stream.ts";
import type { SingleResult, SubagentDetails } from "../../extensions/subagent/types.ts";
import { assistantMessage, makeFakeSpawn, waitFor } from "./helpers.ts";

const makeDetails = (results: SingleResult[]): SubagentDetails => ({ mode: "single", results });

function options(overrides: Partial<RunOptions>): RunOptions {
	return {
		defaultCwd: "/repo",
		defaults: {},
		agentName: "explorer",
		task: "inspect the code",
		makeDetails,
		...overrides,
	};
}

function promptPath(args: string[]): string | undefined {
	const index = args.indexOf("--append-system-prompt");
	return index === -1 ? undefined : args[index + 1];
}

describe("runSingleAgent", () => {
	test("captures output, stderr, and usage from a successful run", async () => {
		const { spawn } = makeFakeSpawn((child) => {
			child.line({
				type: "message_end",
				message: assistantMessage("all done", { input: 7, output: 3, totalTokens: 10, cost: 0.02 }),
			});
			child.emitStderr("a warning");
			child.close(0);
		});

		const result = await runSingleAgent(options({ spawn }));
		expect(result.exitCode).toBe(0);
		expect(getFinalOutput(result.messages)).toBe("all done");
		expect(result.stderr).toBe("a warning");
		expect(result.usage).toMatchObject({ turns: 1, input: 7, output: 3, contextTokens: 10 });
		expect(result.usage.cost).toBeCloseTo(0.02);
		expect(result.model).toBe("claude-sonnet-4-5");
		expect(isFailedResult(result)).toBe(false);
	});

	test("marks the result as running while the process is in flight", async () => {
		const seen: SingleResult[] = [];
		const { spawn, children } = makeFakeSpawn((child) => {
			child.line({ type: "message_end", message: assistantMessage("working") });
		});

		const promise = runSingleAgent(
			options({
				spawn,
				onUpdate: (partial) => seen.push(partial.details?.results[0] as SingleResult),
			}),
		);
		await waitFor(() => seen.length > 0);
		expect(seen[0].exitCode).toBe(-1);

		children[0].close(0);
		await promise;
	});

	test("parses a final line that has no trailing newline", async () => {
		const { spawn } = makeFakeSpawn((child) => {
			child.write(JSON.stringify({ type: "message_end", message: assistantMessage("tail") }));
			child.close(0);
		});
		const result = await runSingleAgent(options({ spawn }));
		expect(getFinalOutput(result.messages)).toBe("tail");
	});

	test("reports a non-zero exit as failure", async () => {
		const { spawn } = makeFakeSpawn((child) => child.close(1));
		const result = await runSingleAgent(options({ spawn }));
		expect(result.exitCode).toBe(1);
		expect(isFailedResult(result)).toBe(true);
	});

	test("propagates a model error and its message", async () => {
		const { spawn } = makeFakeSpawn((child) => {
			child.line({
				type: "message_end",
				message: assistantMessage("", { stopReason: "error", errorMessage: "quota exceeded" }),
			});
			child.close(0);
		});
		const result = await runSingleAgent(options({ spawn }));
		expect(isFailedResult(result)).toBe(true);
		expect(getResultOutput(result)).toBe("quota exceeded");
	});

	test("rejects an unknown agent without spawning", async () => {
		const { spawn, children } = makeFakeSpawn();
		const result = await runSingleAgent(options({ agentName: "ghost", spawn }));
		expect(children).toHaveLength(0);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Available agents");
		expect(result.stderr).toContain("explorer");
	});

	test("aborts the child and throws", async () => {
		const controller = new AbortController();
		const { spawn, children } = makeFakeSpawn(() => {
			/* hold the process open until the test closes it */
		});

		const promise = runSingleAgent(options({ signal: controller.signal, spawn }));
		await waitFor(() => children.length === 1);
		controller.abort();
		children[0].close(0);

		await expect(promise).rejects.toThrow("aborted");
		expect(children[0].killSignals).toContain("SIGTERM");
	});

	test("removes the temporary system-prompt file", async () => {
		let seenPath: string | undefined;
		const { spawn } = makeFakeSpawn((child) => {
			seenPath = promptPath(child.args);
			expect(seenPath && existsSync(seenPath)).toBe(true);
			child.close(0);
		});

		await runSingleAgent(options({ spawn }));
		expect(seenPath).toBeTruthy();
		expect(existsSync(seenPath!)).toBe(false);
	});
});
