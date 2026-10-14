/**
 * The notify capability's configuration shape.
 *
 * The settings live in the `notify` section of `bytefly.json`; see
 * `./config.ts` for the loader and the defaults.
 */

/** How a notification leaves the process. `auto` picks from the environment. */
export const NOTIFY_METHODS = ["auto", "osascript", "notify-send", "toast", "osc777", "osc99"] as const;

/** One of {@link NOTIFY_METHODS}. */
export type NotifyMethod = (typeof NOTIFY_METHODS)[number];

/** Settings for bytefly's OS notifications. */
export interface NotifyConfig {
	/** Master switch. Off by default: a notification on every turn is opt-in. */
	enabled: boolean;
	/** Notify when a full agent run settles and Pi waits for the next message. */
	turnFinished: boolean;
	/** Notify when Pi opens a prompt mid-run, i.e. the agent is asking for input. */
	needsInput: boolean;
	/** Notify when a background `job` finishes. */
	jobFinished: boolean;
	/** Delivery method; `auto` chooses by terminal and platform. */
	method: NotifyMethod;
	/** Notification title, e.g. `Pi`. */
	title: string;
}
