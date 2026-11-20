/**
 * A context double whose shared `ui` reports a remote-answered turn.
 *
 * Mirrors the marker a chat turn installs on the host UI context, so an
 * extension can be tested on its remote path (dialogs instead of a full-screen
 * component, with an optional file/text preface) without a bridge. See
 * `lib/interaction.ts`.
 */

import { INTERACTION_TURN_KEY, type InteractionChannel } from "../../lib/interaction.ts";
import { fakeCtx, type FakeCtxOptions, type FakeCtxResult } from "./context.ts";

/**
 * Mark an existing context double as answered by a remote channel, the way a chat turn
 * does, so a suite can take the remote path without building a second context.
 */
export function markRemote(ctx: FakeCtxResult["ctx"], channel: InteractionChannel): void {
	(ctx.ui as Record<string, unknown>)[INTERACTION_TURN_KEY] = channel;
}

/**
 * The channel a remote turn installs, answering every dialog as cancelled.
 *
 * A case that only needs a turn to *be* remote takes this; one that asserts on what was
 * asked builds the channel it wants.
 */
export function quietChannel(): InteractionChannel {
	return {
		isActive: () => true,
		request: async () => ({ kind: "cancelled" }),
		post: async () => {},
		postFile: async () => true,
	};
}

export interface RemoteCtxResult extends FakeCtxResult {
	/** Text posted to the remote channel. */
	posted: string[];
	/** Files sent to the remote channel. */
	files: Array<{ path: string; name: string }>;
	/** Outbound events in call order: `file`, `post`, `select`, and `editor`. */
	events: string[];
	/** Force the next `postFile` to succeed or fail. */
	setFileResult(value: boolean): void;
	/** The prompt bounds the caller asked for, in order. */
	timeouts: number[];
}

/** Like {@link fakeCtx}, but the turn is owned by a remote channel. */
export function remoteCtx(options: FakeCtxOptions = {}): RemoteCtxResult {
	const result = fakeCtx({ mode: "tui", hasUI: true, ...options });
	const posted: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	const events: string[] = [];
	const timeouts: number[] = [];
	let fileResult = true;
	const channel: InteractionChannel = {
		isActive: () => true,
		request: async () => ({ kind: "cancelled" }),
		post: async (text) => {
			posted.push(text);
			events.push("post");
		},
		postFile: async (path, name) => {
			files.push({ path, name });
			events.push("file");
			return fileResult;
		},
		setPromptTimeout: (ms) => {
			timeouts.push(ms);
			return () => {};
		},
	};
	markRemote(result.ctx, channel);
	const editor = result.ctx.ui.editor;
	result.ctx.ui.editor = async (title: string, prefill?: string) => {
		events.push("editor");
		return editor(title, prefill);
	};
	const select = result.ctx.ui.select;
	result.ctx.ui.select = async (title: string, labels: string[]) => {
		events.push("select");
		return select(title, labels);
	};
	return {
		...result,
		posted,
		files,
		events,
		timeouts,
		setFileResult: (value: boolean) => {
			fileResult = value;
		},
	};
}
