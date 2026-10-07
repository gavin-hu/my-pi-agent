/**
 * Shared types for the ask-user-question extension.
 *
 * "Raw" types describe what the model sends. "Question" is the validated,
 * defaulted form the UI drivers work with. A `Selection` is what a driver
 * produces for one question; `Answer` is the normalized, persisted form.
 */

/** An option as supplied by the model. */
export interface RawOption {
	label: string;
	description?: string;
}

/** A question as supplied by the model. */
export interface RawQuestion {
	question: string;
	header?: string;
	options?: RawOption[];
	multiSelect?: boolean;
}

/** A validated question with defaults applied. */
export interface Question {
	/** Stable id echoed back in answers. */
	id: string;
	/** Short tab label, already truncated and de-duplicated. */
	header: string;
	/** Full question text. */
	question: string;
	/** Offered options, without the automatic "Other" entry. */
	options: RawOption[];
	/** Whether a free-form answer is allowed (true when options were offered). */
	allowOther: boolean;
	/** Whether several options may be chosen at once. */
	multiSelect: boolean;
}

/** A user's answer to one question, as produced by a UI driver. */
export type Selection =
	| { type: "options"; values: string[]; labels: string[]; indices: number[] }
	| { type: "custom"; text: string };

/** One normalized answer in the tool result. */
export interface Answer {
	id: string;
	header: string;
	question: string;
	values: string[];
	labels: string[];
	wasCustom: boolean;
	indices?: number[];
}

/** Structured result carried in the tool's `details`. */
export interface AskResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
	unavailable?: boolean;
}
