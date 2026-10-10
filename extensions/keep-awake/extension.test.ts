import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_DISABLED_EXTENSIONS } from "../../lib/env.ts";
import { GLYPHS, STATUS_KEYS } from "../../lib/ui.ts";
import { releaseWakeHold, requestWakeHold } from "../../lib/wake-hold.ts";
import { fakeCtx } from "../../test/helpers/context.ts";
import { tempDir, withAgentDir, withEnv } from "../../test/helpers/env.ts";
import { emit, makeFakePi } from "../../test/helpers/fakes.ts";
import { type KillTreeFn, makeJobSpawn } from "../../test/helpers/process.ts";
import { DEFAULT_CONFIG } from "./config.ts";
import keepAwake from "./index.ts";
import type { KeepAwakeDeps } from "./runtime.ts";

function setup(overrides: Partial<KeepAwakeDeps> = {}, loadFromCwd = false) {
	const { spawn, children } = makeJobSpawn();
	const kills: Array<{ pid: number; signal: NodeJS.Signals }> = [];
	const killTree: KillTreeFn = (pid, signal) => {
		kills.push({ pid, signal });
	};
	const deps: KeepAwakeDeps = {
		spawn,
		killTree,
		platform: "darwin",
		piPid: 4242,
		config: DEFAULT_CONFIG,
		...overrides,
	};
	if (loadFromCwd) deps.config = undefined;
	const { pi, commands, handlers, flags } = makeFakePi();
	keepAwake(pi, deps);
	return { pi, commands, handlers, flags, children, kills };
}

describe("keep-awake extension", () => {
	test("registers nothing when disabled through PI_DISABLED_EXTENSIONS", async () => {
		await withEnv({ [ENV_DISABLED_EXTENSIONS]: "keep-awake" }, () => {
			const { commands, handlers } = setup();
			expect(commands.size).toBe(0);
			expect(handlers.size).toBe(0);
		});
	});

	test("registers the command and the lifecycle handlers", () => {
		const { commands, handlers } = setup();
		expect(commands.has("keep-awake")).toBe(true);
		for (const event of ["session_start", "agent_start", "agent_settled", "session_shutdown"]) {
			expect(handlers.get(event)?.length).toBe(1);
		}
	});

	test("auto acquires while the agent runs and releases when it settles", async () => {
		const { pi, children, kills } = setup();
		const ctx = fakeCtx({ mode: "tui" }).ctx;

		await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(children).toHaveLength(0);

		await emit(pi, "agent_start", { type: "agent_start" }, ctx);
		expect(children).toHaveLength(1);

		await emit(pi, "agent_settled", { type: "agent_settled" }, ctx);
		expect(kills).toHaveLength(1);
	});

	test("always acquires at session start and releases at shutdown", async () => {
		const { pi, children, kills } = setup({ config: { mode: "always", keepDisplay: false } });
		const ctx = fakeCtx({ mode: "tui" }).ctx;

		await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(children).toHaveLength(1);
		expect(ctx.statuses.has(STATUS_KEYS.keepAwake)).toBe(true);

		await emit(pi, "session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		expect(kills).toHaveLength(1);
		expect(ctx.statuses.has(STATUS_KEYS.keepAwake)).toBe(false);
	});

	test("an external wake hold keeps the machine awake while the agent is idle", async () => {
		const { pi, children, kills } = setup();
		const ctx = fakeCtx({ mode: "tui" }).ctx;
		await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
		expect(children).toHaveLength(0);

		requestWakeHold(pi, "wechat");
		expect(children).toHaveLength(1);
		expect(ctx.statuses.get(STATUS_KEYS.keepAwake)).toBe(`${GLYPHS.keepAwake} hold`);

		releaseWakeHold(pi, "wechat");
		expect(kills).toHaveLength(1);
		expect(ctx.statuses.has(STATUS_KEYS.keepAwake)).toBe(false);
	});

	test("a wake hold is ignored before session_start and after shutdown", async () => {
		const { pi, children, kills } = setup();
		const ctx = fakeCtx({ mode: "tui" }).ctx;

		requestWakeHold(pi, "wechat");
		expect(children).toHaveLength(0);

		await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
		requestWakeHold(pi, "wechat");
		expect(children).toHaveLength(1);

		await emit(pi, "session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		expect(kills).toHaveLength(1);
		// A late release from another extension must not touch a dead context.
		releaseWakeHold(pi, "wechat");
		expect(kills).toHaveLength(1);
	});

	test("loads project config from the session cwd", async () => {
		await withAgentDir(async () => {
			const repo = tempDir("keep-awake-repo-");
			mkdirSync(join(repo, ".pi"), { recursive: true });
			writeFileSync(join(repo, ".pi", "keep-awake.json"), JSON.stringify({ mode: "always" }));
			const { pi, children } = setup({}, true);
			const ctx = fakeCtx({ mode: "tui", cwd: repo }).ctx;

			await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
			expect(children).toHaveLength(1);
		}, "keep-awake-global-");
	});

	test("an injected config wins over the cwd file", async () => {
		await withAgentDir(async () => {
			const repo = tempDir("keep-awake-repo-");
			mkdirSync(join(repo, ".pi"), { recursive: true });
			writeFileSync(join(repo, ".pi", "keep-awake.json"), JSON.stringify({ mode: "always" }));
			const { pi, children } = setup({ config: DEFAULT_CONFIG });
			const ctx = fakeCtx({ mode: "tui", cwd: repo }).ctx;

			await emit(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
			expect(children).toHaveLength(0);
		}, "keep-awake-global-");
	});
});
