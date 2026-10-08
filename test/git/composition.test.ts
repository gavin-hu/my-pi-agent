import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import gitExtensions from "../../extensions/git/index.ts";
import { canonicalize } from "../../extensions/git/worktree/git.ts";
import { getInactiveOverrides } from "../../extensions/git/worktree/runtime.ts";
import { createFakePi, emit } from "../helpers/fakes.ts";

/** The merged entry Pi records as the source of every tool it registers. */
const ENTRY = canonicalize(fileURLToPath(new URL("../../extensions/git/index.ts", import.meta.url)));

const ROOT_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;

/** Minimal context for the `session_start` pass that computes override status. */
function sessionCtx() {
	return {
		cwd: process.cwd(),
		hasUI: false,
		mode: "print",
		ui: {
			notify: () => {},
			setStatus: () => {},
			confirm: async () => true,
			select: async () => undefined,
			input: async () => undefined,
		},
		sessionManager: {
			getSessionId: () => "composition-test",
			getBranch: () => [],
			getLeafId: () => undefined,
		},
	} as any;
}

function sourcedTools(path: string) {
	return ROOT_TOOLS.map((name) => ({
		name,
		description: "",
		parameters: {},
		promptGuidelines: [],
		exposure: "direct",
		sourceInfo: { path, source: "extension", scope: "temporary", origin: "top-level" },
	}));
}

describe("git extension composition", () => {
	test("registers the git tool, the worktree tools, and both commands", () => {
		const fake = createFakePi();
		gitExtensions(fake.pi);

		for (const name of ["git", "enter_worktree", "exit_worktree", "prune_worktrees", "list_worktrees"]) {
			expect(fake.tools.has(name), name).toBe(true);
		}
		expect(fake.commands.has("worktree")).toBe(true);
		expect(fake.commands.has("rewind")).toBe(true);
		expect(fake.flags.has("worktree")).toBe(true);
		// The git tool stays read-only through the composition root.
		expect(fake.tools.get("git").annotations.readOnlyHint).toBe(true);
	});

	test("reports no inactive overrides when the merged entry sources them", async () => {
		const fake = createFakePi({ allTools: sourcedTools(ENTRY) });
		gitExtensions(fake.pi);
		await emit(fake.pi, "session_start", { reason: "startup" }, sessionCtx());

		expect(getInactiveOverrides()).toEqual([]);
	});

	test("reports foreign built-in overrides as inactive", async () => {
		const fake = createFakePi({ allTools: sourcedTools("builtin:read") });
		gitExtensions(fake.pi);
		await emit(fake.pi, "session_start", { reason: "startup" }, sessionCtx());

		expect(getInactiveOverrides()).toEqual([...ROOT_TOOLS]);
	});
});
