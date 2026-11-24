/**
 * Where a settings write lands: the repository's checkout, not the tree the shell sits in.
 *
 * `.pi/bytefly.json` is not tracked, so a project-scope row written at the session's cwd is one
 * the board and the footer never read. The runtime takes a `settingsRoot` and both halves use it;
 * these cases prove the path, the write and the read-after-write, on a board row — the section
 * whose normalizer answers a flat shape (the difference that made the screen show defaults).
 *
 * It is its own suite because `settings-runtime.test.ts` is at the suite bar, and the two halves
 * are one capability: a settings root the screen honours.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../../../test/helpers/env.ts";
import { makeStore } from "../../../test/helpers/fixtures/picker.ts";
import { makeTempTracker } from "../../../test/helpers/git.ts";
import { configPath, createSettingsRuntime, type SettingsRuntime } from "./settings-runtime.ts";

const temps = makeTempTracker();
afterAll(() => temps.flush());

/** One runtime whose session cwd is `cwd` and whose project document is at `settingsRoot`. */
function bootAt(root: string, cwd: string, projectDoc: Record<string, unknown>, trusted = true) {
	const agentDir = temps.track(tempDir("bytefly-root-agent-"));
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "bytefly.json"), JSON.stringify(projectDoc));
	const store = makeStore({ trusted });
	const notices: string[] = [];
	const runtime = createSettingsRuntime({
		stores: { global: store.store, project: store.store },
		cwd,
		agentDir,
		settingsRoot: root,
		trusted,
		onError: (message) => notices.push(message),
	});
	return { runtime, notices, rootPath: join(root, ".pi", "bytefly.json") };
}

function value(runtime: SettingsRuntime, id: string): string | undefined {
	return runtime.views("project").find((entry) => entry.id === id)?.value;
}

describe("a settings root", () => {
	test("is the project path a worktree session writes and reads", () => {
		expect(configPath("project", "/worktree", "/agent", "/checkout")).toBe(join("/checkout", ".pi", "bytefly.json"));
		// The default is the cwd, which is what a directory outside a repository has.
		expect(configPath("project", "/worktree", "/agent")).toBe(join("/worktree", ".pi", "bytefly.json"));
	});

	test("takes the row at the root, and the screen reads back what the file states", async () => {
		const root = temps.track(tempDir("bytefly-root-checkout-"));
		const cwd = temps.track(tempDir("bytefly-root-worktree-"));
		const { runtime, notices, rootPath } = bootAt(root, cwd, { board: { wip: { plan: 4 } } });

		// The section's numbers are read, not the defaults: `wip` nests, the normalizer is flat.
		expect(value(runtime, "board.wip.plan")).toBe("4");
		expect(await runtime.setValue("project", "board.wip.perOwner", "3")).toBe(true);
		expect(JSON.parse(readFileSync(rootPath, "utf-8")).board.wip).toMatchObject({ plan: 4, perOwner: 3 });
		expect(value(runtime, "board.wip.perOwner")).toBe("3");
		// The session's tree is untouched, and nothing was reported as a refusal.
		expect(existsSync(join(cwd, ".pi", "bytefly.json"))).toBe(false);
		expect(notices).toEqual([]);
	});
});
