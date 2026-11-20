/**
 * The review page's tool surface: the open that hands a person the address, and
 * the read that hands the model what they wrote.
 */

import type { ToolFixture } from "./types.ts";

/** The two `code_review` states a transcript draws. */
export const REVIEW_FIXTURES: ToolFixture[] = [
	{
		name: "code_review-open",
		tool: "code_review",
		group: "package",
		label: "a page served, waiting for a person",
		args: { action: "open", scope: "base" },
		result: {
			content: [
				{
					type: "text",
					text: "Review page: http://127.0.0.1:4781/review/new — http://127.0.0.1:4781/review/new — 3 files on main...HEAD, 0 comments on the page, 0 sent this session, 0 reviewed.",
				},
			],
			details: {
				open: true,
				scope: "base",
				label: "main...HEAD",
				files: 3,
				comments: 0,
				sent: 0,
				reviewed: 0,
				url: "http://127.0.0.1:4781/review/new",
			},
		},
	},
	{
		name: "code_review-comments",
		tool: "code_review",
		group: "package",
		label: "what the reviewer sent",
		args: { action: "comments" },
		result: {
			content: [
				{
					type: "text",
					text: "Review comments sent (2):\ngateway.ts:6 (new) — Name the bound where the caller can read it.\nlimits.ts:2 (new) — Say which port was refused.",
				},
			],
			details: {
				open: true,
				scope: "base",
				label: "main...HEAD",
				files: 3,
				comments: 2,
				sent: 2,
				reviewed: 1,
				url: "http://127.0.0.1:4781/review/new",
				list: [
					{ rel: "gateway.ts", line: 6, side: "new", body: "Name the bound where the caller can read it." },
					{ rel: "limits.ts", line: 2, side: "new", body: "Say which port was refused." },
				],
			},
		},
	},
];
