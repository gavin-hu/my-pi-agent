/**
 * The notification capability's seams double, and the harness a case reads it through.
 *
 * `deliveryRecorder` records what a send wrote to the terminal and what it spawned, so a case
 * asserts the delivery rather than the config that chose it.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotifySeams } from "../../../extensions/bytefly/notify/dispatch.ts";

/** What a scenario hands the case: the live seams, and the session they ran under. */
export interface NotifyHarness {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	written: string[];
	ran: Array<{ command: string; args: string[] }>;
	handle: { notify: (body: string) => void };
}

export interface DeliveryRecorder {
	written: string[];
	ran: Array<{ command: string; args: string[] }>;
	seams: NotifySeams;
}

/** A seams double that records OSC writes and spawned notifier commands. */
export function deliveryRecorder(
	options: { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; isTTY?: boolean } = {},
): DeliveryRecorder {
	const written: string[] = [];
	const ran: Array<{ command: string; args: string[] }> = [];
	return {
		written,
		ran,
		seams: {
			platform: options.platform ?? "linux",
			env: options.env ?? {},
			stdout: {
				write: (chunk: string) => {
					written.push(chunk);
					return true;
				},
				isTTY: options.isTTY ?? false,
			},
			run: (command, args) => ran.push({ command, args }),
		},
	};
}
