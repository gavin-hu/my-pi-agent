/**
 * The question dialog's fixtures: one picker, one multi-select.
 */

import type { Question } from "../../extensions/question/types.ts";

export const QUESTIONS: Question[] = [
	{
		id: "q1",
		header: "Auth",
		question: "Which authentication should the public API use?",
		options: [
			{ label: "OAuth bearer tokens", description: "Delegated, revocable, and what the gateway already speaks" },
			{ label: "Signed cookies", description: "Simpler for the browser, awkward for machine clients" },
			{ label: "Static API keys", description: "Easiest to issue, hardest to rotate" },
		],
		allowOther: true,
		multiSelect: false,
	},
	{
		id: "q2",
		header: "Scope",
		question: "Which scopes should a token carry?",
		options: [{ label: "read" }, { label: "write" }, { label: "admin" }],
		allowOther: false,
		multiSelect: true,
	},
];
