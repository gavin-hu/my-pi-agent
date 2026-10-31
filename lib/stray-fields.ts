/**
 * A field a tool call carries but its action does not act on.
 *
 * An action-shaped tool publishes one flat parameter object, so every field is
 * offered to every action at once; that is harmless only while each action reads
 * its own. A field that reaches an action which never reads it used to be dropped
 * in silence — `board add` with `dependsOn` wrote the card without the link and
 * answered success, and `team offer` with `to` broadcast to every live session
 * while the caller believed it had named one. The caller could not tell what was
 * recorded from what was ignored, and nothing in the result said which.
 *
 * So the table of what each action reads lives with the tool (`ACTION_FIELDS`),
 * and this is the sentence a call is refused with: it names every stray field and
 * the action that does take it, which makes the retry one call away. The table is
 * keyed in the order the actions are documented, because that order is how the
 * message lists the verbs that take a field.
 *
 * Value-only, as `lib/` must be: the tables are the callers'.
 */

import { listOf } from "./format.ts";

/** The fields each action reads, keyed in the order the actions are documented. */
export type ActionFields = Readonly<Record<string, readonly string[]>>;

/**
 * Why a call carries a field its action does not act on, or nothing when it is clean.
 *
 * `undefined` is not a stray: an optional field the caller left out was never passed,
 * and a schema makes every unset one `undefined`.
 */
export function strayField(action: string, args: Record<string, unknown>, fields: ActionFields): string | undefined {
	const mine = fields[action] ?? [];
	const stray = Object.entries(args)
		.filter(([field, value]) => value !== undefined && field !== "action" && !mine.includes(field))
		.map(([field]) => field);
	if (stray.length === 0) return undefined;
	// One stray reads as "takes it"; several need their names, or the sentence stops
	// saying which field goes where.
	const named = (field: string): string => {
		const taking = Object.keys(fields).filter((candidate) => fields[candidate]?.includes(field));
		if (taking.length === 0) return `${field} belongs to no action`;
		const verbs = taking.map((one) => `\`${one}\``);
		// Two read as "a and b"; three or more take the serial comma, or the list stops saying
		// where one verb ends and the next begins.
		const list = verbs.length === 2 ? verbs.join(" and ") : listOf(verbs, "and");
		return `${list} ${taking.length === 1 ? "takes" : "take"} ${stray.length === 1 ? "it" : field}`;
	};
	return `${action} does not act on ${stray.join(", ")}: ${stray.map(named).join("; ")}.`;
}
