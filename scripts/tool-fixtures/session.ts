/**
 * The tools whose state the session owns: todo, goal, and memory.
 *
 * `ask_user_question-cancelled` leads because a cancelled question is the
 * state those three share: the record stays, and the turn moved on.
 */

import type { ToolFixture } from "./types.ts";

/** One entry per session-state tool, in gallery order. */
export const SESSION_FIXTURES: ToolFixture[] = [
	{
		name: "ask_user_question-cancelled",
		tool: "ask_user_question",
		group: "package",
		label: "a cancelled question",
		args: {
			questions: [
				{
					question: "Which retry policy should I implement?",
					header: "Retry",
					options: [{ label: "Exponential + jitter" }, { label: "Fixed delay" }],
				},
			],
		},
		result: {
			content: [{ type: "text", text: "Cancelled" }],
			details: { cancelled: true, questions: [], answers: [] },
		},
	},
	{
		name: "session",
		group: "package",
		label: "the parallel-session board",
		args: { action: "status" },
		result: {
			content: [{ type: "text", text: "Sessions (2)\n- frontend\n- backend" }],
			details: {
				action: "status",
				status: {
					me: { id: "s1", label: "frontend" },
					sessions: [
						{ id: "s1", label: "frontend", cwd: "/repo/frontend", mode: "tui", unread: 0 },
						{ id: "s2", label: "backend", cwd: "/repo/backend", mode: "tui", unread: 1 },
					],
					claims: [],
				},
			},
		},
	},
	{
		name: "todo",
		group: "package",
		label: "a task list with every status",
		args: {
			todos: [
				{ content: "Read the existing auth middleware", status: "completed" },
				{ content: "Add the retry wrapper", status: "in_progress", activeForm: "Adding the retry wrapper" },
				{ content: "Write tests for retry behaviour", status: "pending" },
				{ content: "Update the changelog", status: "pending" },
			],
		},
		result: {
			content: [{ type: "text", text: "Todo list updated (4 items; 1 in progress)." }],
			details: {
				action: "write",
				todos: [
					{ content: "Read the existing auth middleware", status: "completed" },
					{ content: "Add the retry wrapper", status: "in_progress", activeForm: "Adding the retry wrapper" },
					{ content: "Write tests for retry behaviour", status: "pending" },
					{ content: "Update the changelog", status: "pending" },
				],
			},
		},
	},
	{
		name: "goal",
		group: "package",
		label: "an active objective",
		args: { objective: "Add rate limiting to the public API", status: "active" },
		result: {
			content: [{ type: "text", text: "Goal set: Add rate limiting to the public API" }],
			details: { action: "set", goal: { objective: "Add rate limiting to the public API", status: "active" } },
		},
	},
	{
		name: "memory",
		group: "package",
		label: "a note added to project memory",
		args: { action: "add", text: "Prefers bun over npm", scope: "project" },
		result: {
			content: [{ type: "text", text: "Added to project memory: Prefers bun over npm" }],
			details: {
				action: "add",
				scope: "project",
				project: ["Prefers bun over npm", "Run bun run check before committing"],
				global: ["User's name is Gavin"],
				changed: true,
				entry: "Prefers bun over npm",
			},
		},
	},
];
