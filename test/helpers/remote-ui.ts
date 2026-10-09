/**
 * A context double whose shared `ui` reports a remote-answered turn.
 *
 * Mirrors what `installRemoteUI` installs in production, so an extension can be
 * tested on its remote path (dialogs instead of a full-screen component, with an
 * optional file/text preface) without a bridge. See `lib/interaction.ts`.
 */

import { INTERACTION_TURN_KEY, type InteractionChannel } from "../../lib/interaction.ts";
import { fakeCtx, type FakeCtxOptions, type FakeCtxResult } from "./context.ts";

export interface RemoteCtxResult extends FakeCtxResult {
	/** Text posted to the remote channel. */
	posted: string[];
	/** Files sent to the remote channel. */
	files: Array<{ path: string; name: string }>;
	/** Force the next `postFile` to succeed or fail. */
	setFileResult(value: boolean): void;
}

/** Like {@link fakeCtx}, but the turn is owned by a remote channel. */
export function remoteCtx(options: FakeCtxOptions = {}): RemoteCtxResult {
	const result = fakeCtx({ mode: "tui", hasUI: true, ...options });
	const posted: string[] = [];
	const files: Array<{ path: string; name: string }> = [];
	let fileResult = true;
	const channel: InteractionChannel = {
		isActive: () => true,
		request: async () => ({ kind: "cancelled" }),
		post: async (text) => {
			posted.push(text);
		},
		postFile: async (path, name) => {
			files.push({ path, name });
			return fileResult;
		},
	};
	(result.ctx.ui as Record<string, unknown>)[INTERACTION_TURN_KEY] = channel;
	return {
		...result,
		posted,
		files,
		setFileResult: (value: boolean) => {
			fileResult = value;
		},
	};
}
