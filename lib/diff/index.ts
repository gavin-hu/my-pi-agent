/**
 * The change vocabulary a diff page reads: the scopes, the parse, the status rows,
 * and the markup for one.
 *
 * A page takes this barrel. A module on a registration path imports the one it needs
 * instead — `modes.ts` for a query guard, `status.ts` for a list — because reaching
 * `render.ts` loads `lib/highlight.ts`, and a start pays what an entry imports.
 */

export * from "./modes.ts";
export * from "./parse.ts";
export * from "./render.ts";
export * from "./status.ts";
