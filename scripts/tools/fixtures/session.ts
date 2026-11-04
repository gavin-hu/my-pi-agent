/**
 * The session surfaces: the bus tool's six actions, a cancelled question, and the
 * three tools whose state the session owns (todo, goal, memory).
 *
 * `question-cancelled` leads because a cancelled question is the state those three
 * share: the record stays, and the turn moved on. Every bus action is here, because a
 * block no fixture draws is a block no width contract and no gallery image covers.
 */

import type { ToolFixture } from "./types.ts";

/** One entry per session-state tool, in gallery order. */
export const SESSION_FIXTURES: ToolFixture[] = [
	{
		name: "question-cancelled",
		tool: "question",
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
		label: "the bus summary, read before this session joins",
		args: { action: "status" },
		result: {
			content: [{ type: "text", text: "Sessions (3)\n- frontend\n- emma\n- verify-billing" }],
			details: {
				action: "status",
				status: {
					me: { id: "s1", label: "frontend" },
					onBus: false,
					sessions: [
						{ id: "s1", label: "frontend", cwd: "/repo/frontend", mode: "tui", unread: 0, state: "live" },
						{ id: "s2", label: "emma", cwd: "/repo/backend", mode: "tui", unread: 1, state: "live" },
						{ id: "s3", label: "verify-billing", cwd: "/repo/backend", mode: "rpc", unread: 0, state: "gone" },
					],
					claims: [{ path: "src/api", owner: "s2", ownerLabel: "emma", at: 1 }],
				},
			},
		},
	},
	{
		name: "session-expanded",
		tool: "session",
		group: "package",
		label: "the parallel-session board, expanded",
		args: { action: "status" },
		options: { expanded: true },
		result: {
			content: [
				{
					type: "text",
					text: "Sessions (3)\n- frontend (s1) · /repo/frontend · tui\n- backend (s2) · /repo/backend · tui · 1 unread",
				},
			],
			details: {
				action: "status",
				status: {
					me: { id: "s1", label: "frontend" },
					sessions: [
						{
							id: "s1",
							label: "frontend",
							cwd: "/repo/frontend",
							mode: "tui",
							unread: 0,
							pid: 1,
							repoRoot: "/repo",
							startedAt: 1,
							lastSeen: 2,
						},
						{
							id: "s2",
							label: "backend",
							cwd: "/repo/backend",
							mode: "tui",
							unread: 1,
							pid: 2,
							repoRoot: "/repo",
							startedAt: 1,
							lastSeen: 2,
						},
						{
							id: "s3",
							label: "verify-billing",
							cwd: "/repo/backend",
							mode: "rpc",
							unread: 0,
							pid: 3,
							repoRoot: "/repo",
							startedAt: 1,
							lastSeen: 2,
							state: "gone",
						},
					],
					claims: [
						{ path: "src/api", owner: "s2", ownerLabel: "backend", at: 1 },
						{ path: "src/api/routes.ts", owner: "s2", ownerLabel: "backend", at: 1 },
					],
					watching: { armed: true, wake: false },
				},
			},
		},
	},
	{
		name: "session-name",
		tool: "session",
		group: "package",
		label: "a session joining the bus, naming itself",
		args: { action: "join", label: "billing-lead" },
		result: {
			content: [
				{
					type: "text",
					text: 'On the bus as "billing-lead", listening: new messages appear at your next turn.',
				},
			],
			details: { action: "join", label: "billing-lead", watching: { armed: true, wake: false } },
		},
	},
	{
		name: "session-send",
		tool: "session",
		group: "package",
		label: "an event that reached two peers and not the third",
		args: { action: "send", to: "*", kind: "event", text: "contract v2 is approved" },
		options: { expanded: true },
		result: {
			content: [
				{
					type: "text",
					text: "Delivered to backend, billing-core (m-3f2a).\nNot delivered to verify-billing (inbox write failed).",
				},
			],
			details: {
				action: "send",
				delivered: ["backend", "billing-core"],
				failed: [{ label: "verify-billing", error: "inbox write failed" }],
				messageId: "m-3f2a",
			},
		},
	},
	{
		name: "session-inbox",
		tool: "session",
		group: "package",
		label: "a handoff and a message, with one file this build cannot read",
		args: { action: "inbox" },
		options: { expanded: true },
		result: {
			content: [
				{
					type: "text",
					text: "1. emma · handoff · Handoff: #274 is yours. Paths: extensions/session-bus.\n2. backend · message · is checkout.ts free?\nMail this build cannot read: 0001-verify-billing.json — left on disk, cleared by the TTL.",
				},
			],
			details: {
				action: "inbox",
				messages: [
					{
						id: "0002-emma",
						from: "s2",
						fromLabel: "emma",
						to: "s1",
						toLabel: "frontend",
						kind: "handoff",
						text: 'Handoff: #274 "the transcript block" is yours, frontend. Paths: extensions/session-bus. The plan is in the card; record it and start without asking.',
						paths: ["extensions/session-bus"],
						at: 2,
					},
					{
						id: "0003-backend",
						from: "s3",
						fromLabel: "backend",
						to: "s1",
						toLabel: "frontend",
						kind: "message",
						text: "is checkout.ts free?",
						at: 3,
					},
				],
				unreadable: ["0001-verify-billing.json"],
			},
		},
	},
	{
		name: "session-claim",
		tool: "session",
		group: "package",
		label: "a claim refused because a peer holds the path",
		args: { action: "claim", paths: ["src/api"] },
		options: { expanded: true },
		result: {
			content: [{ type: "text", text: "src/api is owned by backend (fedcba654321)." }],
			details: {
				action: "claim",
				claimed: [],
				conflicts: [{ path: "src/api", owner: "fedcba654321", ownerLabel: "backend" }],
			},
		},
	},
	{
		name: "session-release",
		tool: "session",
		group: "package",
		label: "a release that named one path it does not own",
		args: { action: "release", paths: ["src/http", "src/api"] },
		options: { expanded: true },
		result: {
			content: [{ type: "text", text: "Released: src/http.\nNot yours: src/api." }],
			details: { action: "release", released: ["src/http"], notOwned: ["src/api"] },
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
