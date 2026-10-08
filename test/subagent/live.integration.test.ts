/**
 * Live, end-to-end check for the `subagent` extension.
 *
 * Skipped unless `PI_SUBAGENT_E2E=1`, because it calls a real model twice (the
 * parent and one subagent) and needs configured provider credentials. It runs
 * the real `pi` binary, which loads the installed package, then instructs the
 * parent model to delegate to the `subagent` tool and echoes the subagent's
 * reply. This is the only test that exercises the full stack end to end:
 * extension loading, tool registration, subprocess spawn, JSON-event parsing,
 * and model-driven delegation.
 *
 *   pi install .                      # the package must be installed
 *   PI_SUBAGENT_E2E=1 bun test test/subagent/live.integration.test.ts
 *
 * Override the binary or model with `PI_SUBAGENT_E2E_BIN` /
 * `PI_SUBAGENT_E2E_MODEL`.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const enabled = process.env.PI_SUBAGENT_E2E === "1";
const suite = enabled ? describe : describe.skip;

const PI_BIN = process.env.PI_SUBAGENT_E2E_BIN ?? "pi";
const MODEL = process.env.PI_SUBAGENT_E2E_MODEL ?? "deepseek-flash";
const TIMEOUT_MS = 300_000;
const MARKER = `PI_SUBAGENT_E2E_${Date.now()}`;

suite("subagent live end-to-end", () => {
	test(
		"the parent model delegates to a real pi subprocess",
		() => {
			const prompt = [
				"You MUST call the subagent tool exactly once, with these arguments:",
				'  agent: "explorer"',
				`  task: "Reply with exactly the text ${MARKER} and nothing else."`,
				"After the tool returns, output only the subagent result verbatim.",
			].join("\n");

			const result = spawnSync(PI_BIN, ["--no-session", "--model", MODEL, "--thinking", "low", "-p", prompt], {
				encoding: "utf8",
				timeout: TIMEOUT_MS,
				maxBuffer: 16 * 1024 * 1024,
			});

			if (result.error) throw result.error;
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain(MARKER);
		},
		TIMEOUT_MS,
	);

	test(
		"discovers and runs a project-local agent",
		() => {
			const root = mkdtempSync(join(tmpdir(), "pi-subagent-live-"));
			try {
				const agentsDir = join(root, ".pi", "agents");
				mkdirSync(agentsDir, { recursive: true });
				writeFileSync(
					join(agentsDir, "probe.md"),
					`---\nname: liveprobe\ndescription: Replies with a marker\ntools: read\n---\nReply with exactly the text ${MARKER} and nothing else.\n`,
					"utf-8",
				);

				const prompt = [
					"You MUST call the subagent tool exactly once, with these arguments:",
					'  agent: "liveprobe"',
					'  agentScope: "project"',
					`  task: "Reply with exactly the text ${MARKER} and nothing else."`,
					"After the tool returns, output only the subagent result verbatim.",
				].join("\n");

				// `-a` trusts the temp project so the project-agent gate does not block.
				const result = spawnSync(PI_BIN, ["--no-session", "-a", "--model", MODEL, "--thinking", "low", "-p", prompt], {
					cwd: root,
					encoding: "utf8",
					timeout: TIMEOUT_MS,
					maxBuffer: 16 * 1024 * 1024,
				});

				if (result.error) throw result.error;
				expect(result.status, result.stderr).toBe(0);
				expect(result.stdout).toContain(MARKER);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
		TIMEOUT_MS,
	);
});
