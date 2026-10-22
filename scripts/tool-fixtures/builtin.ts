/**
 * Pi's built-in tools, as the gallery draws them.
 *
 * Each fixture is resolved through Pi's public `createXToolDefinition(cwd)`
 * factories, so the renderer is the one a session uses. Every path here is
 * synthetic: the gallery ships in the repo.
 */

import type { ToolFixture } from "./types.ts";

/** One entry per built-in tool surface, in gallery order. */
export const BUILTIN_FIXTURES: ToolFixture[] = [
	{
		name: "read",
		group: "builtin",
		label: "a file excerpt (expanded)",
		args: { path: "src/cli.ts", offset: 1, limit: 8 },
		// A collapsed read renders nothing, so the gallery shows it expanded.
		options: { expanded: true },
		result: {
			content: [
				{
					type: "text",
					text: [
						"#!/usr/bin/env node",
						'import { parseArgs } from "node:util";',
						'import { run } from "./run.js";',
						"",
						'const { values } = parseArgs({ options: { help: { type: "boolean" } } });',
						"",
						"if (values.help) {",
						'  console.log("usage: my-cli [--help]");',
						"}",
					].join("\n"),
				},
			],
		},
	},
	{
		name: "write",
		group: "builtin",
		label: "a created file (content shown on the call)",
		args: {
			path: "src/hello.ts",
			content: ["export function hello(name: string): string {", "  return `Hello, ${name}!`;", "}", ""].join("\n"),
		},
		result: { content: [{ type: "text", text: "Successfully wrote to src/hello.ts" }] },
	},
	{
		name: "edit",
		group: "builtin",
		label: "a diff",
		// `argsComplete: false` skips the renderer's async on-disk preview; the
		// result then supplies `details.diff`, which is what a session shows.
		options: { argsComplete: false },
		args: {
			path: "src/greet.ts",
			edits: [{ oldText: "  return `Hello, ${name}!`;", newText: "  return `Hello, ${name}, welcome back!`;" }],
		},
		result: {
			content: [{ type: "text", text: "Successfully replaced 1 block(s) in src/greet.ts." }],
			details: {
				diff: [
					" 1 export function greet(name: string) {",
					"-2   return `Hello, ${name}!`;",
					"+2   return `Hello, ${name}, welcome back!`;",
					" 3 }",
				].join("\n"),
				patch: "",
				firstChangedLine: 2,
			},
		},
	},
	{
		name: "bash",
		group: "builtin",
		label: "a command that failed (collapsed)",
		args: { command: "bun run check", timeout: 60 },
		options: { expanded: false, durationMs: 1420 },
		result: {
			isError: true,
			content: [
				{
					type: "text",
					text: [
						"Checked 128 files in 214ms",
						"src/cli.ts(12,1): error TS2304: Cannot find name 'run'.",
						"",
						"Command exited with code 1",
					].join("\n"),
				},
			],
		},
	},
	{
		name: "grep",
		group: "builtin",
		label: "matches found so far (still running)",
		args: { pattern: "renderCall", path: "extensions", glob: "*.ts", limit: 100 },
		// The accent rail: a running call is the one block that spends colour.
		options: { isPartial: true },
		result: {
			content: [
				{
					type: "text",
					text: [
						"extensions/read/index.ts:42:     renderCall(call, theme, ctx) {",
						"extensions/read/index.ts:57:     renderResult(result, opts, theme, ctx) {",
						"extensions/edit/index.ts:88:         renderCall,",
						"extensions/edit/index.ts:89:         renderResult,",
					].join("\n"),
				},
			],
		},
	},
	{
		name: "find",
		group: "builtin",
		label: "matched paths",
		args: { pattern: "**/*.test.ts", path: "extensions", limit: 1000 },
		result: {
			content: [
				{
					type: "text",
					text: ["extensions/read/index.test.ts", "extensions/edit/index.test.ts", "extensions/grep/tui.test.ts"].join(
						"\n",
					),
				},
			],
		},
	},
	{
		name: "ls",
		group: "builtin",
		label: "a directory listing",
		args: { path: "extensions/read", limit: 500 },
		result: {
			content: [{ type: "text", text: ["README.md", "index.test.ts", "index.ts", "tui/"].join("\n") }],
		},
	},
];
