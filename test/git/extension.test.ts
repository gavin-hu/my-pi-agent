import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerGitTool } from "../../extensions/git/tool/index.ts";
import { createFakePi, fakeTheme } from "../helpers/fakes.ts";

function setup(result = { stdout: " M a.txt", stderr: "", code: 0, killed: false }) {
	const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
	const fake = createFakePi({
		exec: async (command, args, options) => {
			calls.push({ command, args, cwd: options?.cwd });
			return result;
		},
	});
	registerGitTool(fake.pi);
	const tool = fake.tools.get("git");
	return { ...fake, tool, calls };
}

const call = (tool: any, params: unknown, ctx: any = { cwd: "/repo" }) =>
	tool.execute("id", params, undefined, undefined, ctx);

describe("git tool", () => {
	test("is registered read-only", () => {
		const { tool } = setup();
		expect(tool.annotations.readOnlyHint).toBe(true);
		expect(tool.annotations.destructiveHint).toBe(false);
	});

	test("runs git with the built argv in ctx.cwd", async () => {
		const { tool, calls } = setup();
		const result = await call(tool, { action: "status" });

		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({ command: "git", args: ["status", "--short", "--branch"], cwd: "/repo" });
		expect(result.content[0].text).toContain("M a.txt");
		expect(result.details.exitCode).toBe(0);
		expect(result.isError).toBeUndefined();
	});

	test("honors PI_WORKTREE_ROOT over ctx.cwd", async () => {
		const previous = process.env.PI_WORKTREE_ROOT;
		process.env.PI_WORKTREE_ROOT = tmpdir();
		try {
			const { tool, calls } = setup();
			await call(tool, { action: "status" });
			expect(calls[0].cwd).toBe(tmpdir());
		} finally {
			if (previous === undefined) delete process.env.PI_WORKTREE_ROOT;
			else process.env.PI_WORKTREE_ROOT = previous;
		}
	});

	test("ignores a stale PI_WORKTREE_ROOT that no longer exists", async () => {
		const previous = process.env.PI_WORKTREE_ROOT;
		process.env.PI_WORKTREE_ROOT = join(tmpdir(), "pi-worktree-missing-dir-xyz");
		try {
			const { tool, calls } = setup();
			await call(tool, { action: "status" });
			expect(calls[0].cwd).toBe("/repo");
		} finally {
			if (previous === undefined) delete process.env.PI_WORKTREE_ROOT;
			else process.env.PI_WORKTREE_ROOT = previous;
		}
	});

	test("reports a git failure as an error result", async () => {
		const { tool } = setup({ stdout: "", stderr: "fatal: not a git repository", code: 128, killed: false });
		const result = await call(tool, { action: "log" });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("not a git repository");
		expect(result.details.exitCode).toBe(128);
	});

	test("rejects an invalid ref without running git", async () => {
		const { tool, calls } = setup();
		const result = await call(tool, { action: "show", ref: "--upload-pack=x" });

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Invalid ref");
		expect(calls).toHaveLength(0);
	});
});

describe("git tool rendering", () => {
	const renderCall = (tool: any, args: Record<string, unknown>): string =>
		tool.renderCall(args, fakeTheme).render(80).join("\n");

	test("shows the plain invocation for a bare action", () => {
		const { tool } = setup();
		expect(renderCall(tool, { action: "status" }).trim()).toBe("git status");
	});

	test("shows diff flags", () => {
		const { tool } = setup();
		const text = renderCall(tool, { action: "diff", staged: true, stat: true });
		expect(text).toContain("git diff --cached --stat");
	});

	test("shows log limit and ref", () => {
		const { tool } = setup();
		const text = renderCall(tool, { action: "log", limit: 5, ref: "main" });
		expect(text).toContain("git log -n5 main");
	});

	test("shows a path after --", () => {
		const { tool } = setup();
		const text = renderCall(tool, { action: "diff", path: "src/app.ts" });
		expect(text).toContain("git diff -- src/app.ts");
	});

	test("renders an error result with its message", () => {
		const { tool } = setup();
		const result = { content: [{ type: "text", text: "fatal: not a git repository" }], isError: true };
		const text = tool.renderResult(result, { expanded: false }, fakeTheme).render(80).join("\n");
		expect(text).toContain("fatal: not a git repository");
	});
});
