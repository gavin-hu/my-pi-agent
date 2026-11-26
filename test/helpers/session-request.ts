/**
 * A host for the caller half of a request over `pi.events`.
 *
 * `lib/session-tool.ts` asks other extensions for things a command cannot do itself — joining the
 * team, leaving it — and every one of those is the same handshake: emit on a channel, let the owner
 * claim it with `respond`, and settle once. Two suites drive that handshake, so the double that
 * stands in for `pi` lives here: a local copy in each is how a suite stops testing the channel it
 * thinks it does, and `test/shared-helpers.test.ts` refuses the copy anyway.
 *
 * `loaded` is the one switch: `false` is a host with no `session` tool registered at all, which is
 * the "no bus" answer a caller reports rather than a promise that never settles.
 */
export function requestHost<R>(answer?: (request: R) => void, options: { loaded?: boolean } = {}) {
	const emitted: Array<{ channel: string; data: unknown }> = [];
	return {
		emitted,
		host: {
			events: {
				on: () => () => {},
				emit: (channel: string, data: unknown) => {
					emitted.push({ channel, data });
					if (answer) answer(data as R);
				},
			},
			getAllTools: () => (options.loaded === false ? [] : [{ name: "session" }]),
		},
	};
}
