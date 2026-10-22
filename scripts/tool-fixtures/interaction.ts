/**
 * The two tools that talk to a person: a WeChat message and a question.
 *
 * `send_wechat` reports what left the bridge; `ask_user_question` shows the
 * dialog a turn waits on, and the cancelled variant sits in `variants.ts`.
 */

import type { ToolFixture } from "./types.ts";

/** One entry per interaction tool, in gallery order. */
export const INTERACTION_FIXTURES: ToolFixture[] = [
	{
		name: "send_wechat",
		group: "package",
		label: "a message to the owner",
		args: { text: "The build is green." },
		result: { content: [{ type: "text", text: "Sent to the WeChat owner." }], details: { sent: true } },
	},
	{
		name: "ask_user_question",
		group: "package",
		label: "a two-question answer, one custom",
		args: {
			questions: [
				{
					question: "Which retry policy should I implement?",
					header: "Retry",
					options: [{ label: "Exponential + jitter" }, { label: "Fixed delay" }, { label: "No retries" }],
				},
				{ question: "Any deadline for the retries?", header: "Deadline", options: [{ label: "30s" }, { label: "5m" }] },
			],
		},
		result: {
			content: [{ type: "text", text: "Retry: user selected: 1. Exponential + jitter\nDeadline: user wrote: 60s" }],
			details: {
				cancelled: false,
				questions: [
					{
						id: "q1",
						header: "Retry",
						question: "Which retry policy should I implement?",
						options: [{ label: "Exponential + jitter" }, { label: "Fixed delay" }, { label: "No retries" }],
						allowOther: true,
						multiSelect: false,
					},
					{
						id: "q2",
						header: "Deadline",
						question: "Any deadline for the retries?",
						options: [{ label: "30s" }, { label: "5m" }],
						allowOther: true,
						multiSelect: false,
					},
				],
				answers: [
					{
						id: "q1",
						header: "Retry",
						question: "Which retry policy should I implement?",
						values: ["Exponential + jitter"],
						labels: ["Exponential + jitter"],
						wasCustom: false,
						indices: [1],
					},
					{
						id: "q2",
						header: "Deadline",
						question: "Any deadline for the retries?",
						values: ["60s"],
						labels: ["60s"],
						wasCustom: true,
					},
				],
			},
		},
	},
];
