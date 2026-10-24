/**
 * The failed check the `/check` screen draws, with the locations it parsed.
 */

import { CheckResult } from "../../../extensions/check/types.ts";

export const CHECK_RESULT: CheckResult = {
	target: "all",
	status: "failed",
	commands: ["bun run check"],
	exitCode: 1,
	durationMs: 12_400,
	truncated: false,
	failures: [
		{
			path: "extensions/check/detect.test.ts",
			line: 56,
			column: 21,
			message: 'expected "cargo test" to be "cargo test --all"',
			command: "bun run check",
		},
		{
			path: "extensions/check/failures.test.ts",
			line: 41,
			message: "expected 2 failures, got 0",
			command: "bun run check",
		},
		{ test: "TestDetect", message: "Test failed", command: "go test ./..." },
	],
	tail: "src/check.test.ts:12: nope\nmore output",
};
