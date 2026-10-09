/**
 * A context double whose shared `ui` reports a remote-answered turn.
 *
 * Mirrors what `installRemoteUI` installs in production, so an extension can be
 * tested on its remote path (dialogs instead of a full-screen component) without
 * a bridge. See `lib/interaction.ts`.
 */

import { INTERACTION_TURN_KEY } from "../../lib/interaction.ts";
import { fakeCtx, type FakeCtxOptions, type FakeCtxResult } from "./context.ts";

/** Like {@link fakeCtx}, but the turn is owned by a remote channel. */
export function remoteCtx(options: FakeCtxOptions = {}): FakeCtxResult {
	const result = fakeCtx({ mode: "tui", hasUI: true, ...options });
	(result.ctx.ui as Record<string, unknown>)[INTERACTION_TURN_KEY] = () => true;
	return result;
}
