/**
 * The shared transcript notice: one custom-message type that any extension in
 * the package can post, plus the model-facing content and the renderer-facing
 * details it carries.
 *
 * Pi renders a custom message only when it was sent with `display: true`, and
 * it resolves a renderer by the exact `customType` — there is no wildcard — so
 * the type and the shape behind it are one contract the producing extension and
 * bytefly's renderer must agree on. Keep both here, never re-typed on either
 * side.
 *
 * `content` is what the model reads; `details` is never sent to the model and
 * is the renderer's whole input, so a producer states the facts once and the
 * renderer decides the look. Value-only: constants and pure functions, no
 * state.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

/** The custom-message type every transcript notice is sent under. */
export const NOTICE_TYPE = "my-pi-agent/notice";

/** How a notice, or one of its rows, reads at a glance. */
export type NoticeSeverity = "info" | "ok" | "warn" | "bad";

/** One row under a notice's headline. */
export interface NoticeItem {
	/** The row's text, e.g. `j1 build`. Sanitized by the renderer. */
	label: string;
	/** Short trailing detail, e.g. `exit 1`. Sanitized by the renderer. */
	detail?: string;
	/** The row's severity; falls back to the notice's own. */
	severity?: NoticeSeverity;
}

/** Everything the renderer draws, and nothing the model sees. */
export interface NoticeDetails {
	/** Who raised it, e.g. `job` or `watch`. */
	source: string;
	/** One-line headline. */
	title: string;
	/** The headline's severity; a row may override it. */
	severity?: NoticeSeverity;
	/** Rows under the headline, in order. */
	items?: readonly NoticeItem[];
}

export interface NoticeInput {
	/** Model-facing text; the notice is also shown when non-empty. */
	content: string;
	/** Renderer-facing structure. */
	details: NoticeDetails;
}

/** The message shape both send paths accept (`pi.sendMessage`, `before_agent_start`). */
export interface NoticeMessage {
	customType: string;
	content: string;
	display: true;
	details: NoticeDetails;
}

/** A conversation message narrowed to a notice. */
export type NoticeEntry = AgentMessage & { customType: string; details?: NoticeDetails };

/** Build a visible notice message: shared type, `display: true`, the given content and details. */
export function noticeMessage(input: NoticeInput): NoticeMessage {
	return { customType: NOTICE_TYPE, content: input.content, display: true, details: input.details };
}

/** Whether a conversation message is a notice. */
export function isNotice(message: AgentMessage): message is NoticeEntry {
	return message.role === "custom" && (message as { customType?: string }).customType === NOTICE_TYPE;
}

/**
 * Keep only the newest notice of `source` in a transcript, so stale injected
 * context does not accumulate. Notices of other sources and every non-notice
 * are left alone. Returns `undefined` when nothing is stale, so a `context`
 * handler can leave the messages untouched.
 */
export function pruneStaleNotices(messages: readonly AgentMessage[], source: string): AgentMessage[] | undefined {
	const ofSource = messages.filter((message) => isNotice(message) && message.details?.source === source);
	if (ofSource.length <= 1) return undefined;
	const keep = ofSource[ofSource.length - 1];
	return messages.filter((message) => !(isNotice(message) && message.details?.source === source && message !== keep));
}
