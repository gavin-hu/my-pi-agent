import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type RewindConfig } from "../../extensions/rewind/config.ts";
import { createSnapshotPolicy } from "../../extensions/rewind/policy.ts";
import { createFakePi } from "../helpers/fakes.ts";

const tools = [
	{ name: "read", annotations: { readOnlyHint: true } },
	{ name: "grep", annotations: { readOnlyHint: true } },
	{ name: "git", annotations: { readOnlyHint: true } },
	{ name: "write", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "edit", annotations: { readOnlyHint: false, destructiveHint: true } },
	{ name: "bash" },
	{ name: "subagent", annotations: { readOnlyHint: false } },
	{ name: "ask_user_question" },
];

function policy(overrides: Partial<RewindConfig> = {}) {
	const fake = createFakePi({ allTools: tools });
	return createSnapshotPolicy(fake.pi, { ...DEFAULT_CONFIG, ...overrides });
}

describe("createSnapshotPolicy", () => {
	test("never snapshots structured readers or trackers", () => {
		const subject = policy();
		for (const name of ["read", "grep", "git", "todo", "goal"]) {
			expect(subject.shouldSnapshot(name)).toBe(false);
		}
	});

	test("snapshots mutating and unknown tools, including bash", () => {
		const subject = policy();
		for (const name of ["write", "edit", "bash", "subagent", "some_mcp_tool"]) {
			expect(subject.shouldSnapshot(name)).toBe(true);
		}
	});

	test("never snapshots its own tools", () => {
		const subject = policy();
		expect(subject.shouldSnapshot("ask_user_question")).toBe(false);
	});

	test("watch forces a tool to count", () => {
		expect(policy({ watch: ["read"] }).shouldSnapshot("read")).toBe(true);
	});

	test("ignore excludes a tool", () => {
		expect(policy({ ignore: ["bash"] }).shouldSnapshot("bash")).toBe(false);
	});
});
