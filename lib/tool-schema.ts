/**
 * The string-enum schema a tool's parameters are built from.
 *
 * Pi validates tool arguments as JSON Schema, and a provider that supports neither
 * `anyOf` nor `const` — Google, among others — needs the one form that is a plain
 * string with its values listed: `{ type: "string", enum: [...] }`. Pi ships that
 * as `StringEnum`, and writes it as a TypeBox `TUnsafe<T>` so that a parameter
 * declared with it infers as the union of its values.
 *
 * Two spellings of one function disagree about that. The typings pi-ai publishes
 * describe `StringEnum` as a `@earendil-works/pi-schema` schema, which TypeBox's
 * `Static` cannot map, so since Pi 1.5.0 a parameter built from it infers as
 * `unknown` and the switches over `action`, `status`, and `signal` lose their
 * unions — under `bun run check:types` only. The module Pi hands an extension at
 * run time (`pi-ai-extension-view`, behind `VIRTUAL_MODULES`) is still
 * `Type.Unsafe`, which is the same value and the same type this tree needs.
 *
 * So this is a type, not a second implementation: the body stays pi-ai's, and the
 * cast claims only what Pi's runtime view already gives the call — that its result
 * is a TypeBox unsafe schema whose `Static` is the values it was handed. The two
 * spellings are unrelated to the compiler (one branded `~unsafe`, the other a
 * pi-schema brand), which is why the claim is made through `unknown`.
 * `tool-schema.test.ts` holds the two to the same JSON Schema.
 */

import { StringEnum as hostStringEnum } from "@earendil-works/pi-ai";
import type { TUnsafe } from "typebox";

/**
 * A string schema restricted to `values`, as `{ type: "string", enum: [...] }`,
 * typed as the union of those values rather than as `string`.
 */
export function StringEnum<const Values extends readonly string[]>(
	values: Values,
	options?: { description?: string; default?: Values[number] },
): TUnsafe<Values[number]> {
	return hostStringEnum(values, options) as unknown as TUnsafe<Values[number]>;
}
