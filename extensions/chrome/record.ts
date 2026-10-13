/**
 * JSON guard shared by the chrome footer's config and price modules.
 *
 * A config file is untrusted input: every field is validated from `unknown`,
 * and a non-object (including an array) means "unset" rather than throwing.
 * This is the same guard in both `config.ts` and `price/schedule.ts`, so it
 * lives here instead of in each.
 */

/** `value` when it is a plain object, otherwise `undefined`. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
