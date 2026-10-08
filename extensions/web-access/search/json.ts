/**
 * Defensive narrowing for the loosely-typed JSON the search backends return.
 *
 * Every field read goes through these helpers so a missing or wrong-typed value
 * becomes `""`/`{}` instead of throwing.
 */

/** A trimmed string, or `""` for any non-string. */
export function asString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** An object, or `{}` for null and primitives. Arrays are objects here too. */
export function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
