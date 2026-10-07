import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SpawnFn } from "../../extensions/subagent/types.ts";
import { createFakePi, fakeTheme as sharedFakeTheme } from "../helpers/fakes.ts";

/** A scriptable stand-in for a spawned `pi` process. */
export class FakeChild extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	killed = false;
	killSignals: NodeJS.Signals[] = [];
	command = "";
	args: string[] = [];
	options: SpawnOptions | undefined;

	kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killed = true;
		this.killSignals.push(signal);
		return true;
	}

	/** Emit one complete stdout line. */
	line(value: unknown): void {
		const text = typeof value === "string" ? value : JSON.stringify(value);
		this.stdout.emit("data", `${text}\n`);
	}

	write(text: string): void {
		this.stdout.emit("data", text);
	}

	emitStderr(text: string): void {
		this.stderr.emit("data", text);
	}

	close(code = 0): void {
		this.emit("close", code);
	}

	/** Emit a spawn-time error and then a close, as Node does. */
	fail(error: Error = new Error("spawn failed")): void {
		this.emit("error", error);
		this.emit("close", 1);
	}
}

export interface FakeSpawn {
	spawn: SpawnFn;
	children: FakeChild[];
}

/**
 * Build a `SpawnFn` that records children and, once the caller has attached its
 * listeners, runs `script` in a microtask.
 */
export function makeFakeSpawn(script?: (child: FakeChild, args: string[], options: SpawnOptions) => void): FakeSpawn {
	const children: FakeChild[] = [];
	const spawn: SpawnFn = (command, args, options) => {
		const child = new FakeChild();
		child.command = command;
		child.args = args;
		child.options = options;
		children.push(child);
		queueMicrotask(() => script?.(child, args, options));
		return child as unknown as ChildProcess;
	};
	return { spawn, children };
}

/** Wait until `predicate` holds, or throw after `attempts` microtask turns. */
export async function waitFor(predicate: () => boolean, attempts = 50): Promise<void> {
	for (let i = 0; i < attempts; i++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("waitFor timed out");
}

/** An assistant message with the fields the runner reads. */
export function assistantMessage(
	text: string,
	options: {
		model?: string;
		stopReason?: string;
		errorMessage?: string;
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: number;
	} = {},
): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		model: options.model ?? "claude-sonnet-4-5",
		stopReason: options.stopReason ?? "stop",
		errorMessage: options.errorMessage,
		usage: {
			input: options.input ?? 0,
			output: options.output ?? 0,
			cacheRead: options.cacheRead ?? 0,
			cacheWrite: options.cacheWrite ?? 0,
			totalTokens: options.totalTokens ?? 0,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: options.cost ?? 0,
			},
		},
	} as unknown as Message;
}

/** A minimal `ExtensionAPI` that records registered tools. */
export function makeFakePi(): { pi: ExtensionAPI; tools: Map<string, any> } {
	const fake = createFakePi();
	return { pi: fake.pi as ExtensionAPI, tools: fake.tools };
}

/** A minimal tool context; only `cwd`, `model`, and `thinkingLevel` are read. */
export function fakeToolCtx(overrides: { cwd?: string; model?: { provider: string; id: string } | undefined } = {}): any {
	return {
		cwd: overrides.cwd ?? "/repo",
		model: overrides.model === undefined ? { provider: "anthropic", id: "claude-sonnet-4-5" } : overrides.model,
		thinkingLevel: "medium",
	};
}

/** A theme double with identity colorization, for pure render/format tests. */
export function fakeTheme(): any {
	return sharedFakeTheme;
}
