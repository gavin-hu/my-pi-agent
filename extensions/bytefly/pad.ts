/**
 * The transcript's left margin, observed from Pi's built-in output padding.
 *
 * Pi pads its own messages, and hands the value to tool renderers
 * (`context.outputPad`) and message renderers (`options.outputPad`) so they can
 * pad themselves. Entry renderers get only `{ expanded }`, and Pi's chat
 * container carries no padding of its own, so a surface that owns its output
 * must inset itself. This tiny store is the one place the value is shared: the
 * tool frame and the notice record the pad they are handed, and the turn
 * separator reads the last one.
 *
 * There is no module state: the extension factory creates one store per load and
 * injects it, so tests get a fresh one and a second session cannot leak either.
 */

/** Where a bytefly transcript surface reads its left margin. */
export interface PadSource {
	/**
	 * The host's output pad. Pass the pad Pi handed this render to record it for
	 * a surface that never receives one; omit it to read the last recorded value.
	 */
	resolve(hostPad?: number): number;
	/** Record the host pad without resolving, for a renderer that only forwards it. */
	observe(hostPad: number): void;
}

/** Pi's output pad in an interactive session, before one is observed. */
export const DEFAULT_HOST_PAD = 1;

/** A store that follows Pi's output pad, falling back until one is observed. */
export function createPadStore(defaultHostPad: number = DEFAULT_HOST_PAD): PadSource {
	const clamp = (value: number): number => Math.max(0, Math.floor(value));
	let hostPad = Number.isFinite(defaultHostPad) ? clamp(defaultHostPad) : DEFAULT_HOST_PAD;
	// A non-finite observation is ignored rather than resetting the margin.
	const record = (observed: number): void => {
		if (Number.isFinite(observed)) hostPad = clamp(observed);
	};
	return {
		resolve(observed?: number): number {
			if (observed !== undefined) record(observed);
			return hostPad;
		},
		observe(observed: number): void {
			record(observed);
		},
	};
}
