/**
 * Shared helpers for the pi-worktree test suite.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type WorktreeConfig } from "../../extensions/worktree/config.ts";
import { createFakePi, emitFirst } from "../helpers/fakes.ts";

type TestConfigOverrides = Partial<Omit<WorktreeConfig, "guard">> & {
	guard?: Partial<WorktreeConfig["guard"]>;
};

/** Build a config from the production defaults, applying test overrides. */
export function testConfig(overrides: TestConfigOverrides = {}): WorktreeConfig {
	const { guard, ...rest } = overrides;
	return {
		...DEFAULT_CONFIG,
		...rest,
		guard: { ...DEFAULT_CONFIG.guard, ...(guard ?? {}) },
	};
}

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

/** Promise wrapper around execFile that resolves with the exit code instead of rejecting. */
export function execP(
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number },
): Promise<ExecResult> {
	return new Promise((resolve) => {
		const child = execFile(
			command,
			args,
			{ cwd: options?.cwd, timeout: options?.timeout, maxBuffer: 16 * 1024 * 1024, env: process.env },
			(error, stdout, stderr) => {
				const code = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
				resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code, killed: Boolean(child.killed) });
			},
		);
	});
}

/** A minimal `pi` API for driving the extension without the Pi runtime. */
export function makeFakePi() {
	const fake = createFakePi({
		exec: (command, args, options) => execP(command, args, options),
	});
	return fake.pi;
}

export interface FakeCtxOptions {
	cwd: string;
	hasUI?: boolean;
	confirm?: boolean;
	select?: string;
}

/** A minimal `ExtensionContext` for tool and event handlers. */
export function makeFakeCtx(pi: any, options: FakeCtxOptions) {
	const statuses = new Map<string, string | undefined>();
	const notices: string[] = [];
	const hasUI = options.hasUI ?? false;
	const ctx: any = {
		cwd: options.cwd,
		hasUI,
		mode: hasUI ? "tui" : "print",
		ui: {
			confirm: async () => options.confirm ?? true,
			select: async () => options.select ?? "Keep it for later",
			input: async () => undefined,
			notify: (message: string) => {
				notices.push(message);
			},
			setStatus: (key: string, value?: string) => {
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
		},
		sessionManager: {
			getSessionId: () => "test-session",
			getBranch: () => pi.entries,
		},
		notices,
		statuses,
	};
	return ctx;
}

/** Invoke every registered handler for an event, returning the first defined result. */
export async function emitEvent(pi: any, event: string, payload: unknown, ctx: any): Promise<any> {
	return emitFirst(pi, event, payload, ctx);
}

async function git(args: string[], cwd: string): Promise<ExecResult> {
	return execP("git", args, { cwd });
}

/** Create a temp git repo with one commit. */
export async function makeRepo(prefix = "pi-wt-test-"): Promise<string> {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	await git(["init", "-q"], dir);
	await git(["config", "user.email", "test@example.com"], dir);
	await git(["config", "user.name", "Test"], dir);
	writeFileSync(join(dir, "README.md"), "hello\n");
	await git(["add", "."], dir);
	await git(["commit", "-qm", "init"], dir);
	return dir;
}

/** Create a temp repo with an origin remote, pushed main, and origin/HEAD set. */
export async function makeRepoWithRemote(prefix = "pi-wt-remote-"): Promise<{ repo: string; remote: string }> {
	const repo = await makeRepo(prefix);
	const remote = mkdtempSync(join(tmpdir(), "pi-wt-bare-"));
	await git(["init", "--bare", "-q"], remote);
	await git(["remote", "add", "origin", remote], repo);
	await git(["push", "-q", "-u", "origin", "HEAD:main"], repo);
	await git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], repo);
	return { repo, remote };
}

export function cleanup(...dirs: Array<string | undefined>): void {
	for (const dir of dirs) {
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
}
