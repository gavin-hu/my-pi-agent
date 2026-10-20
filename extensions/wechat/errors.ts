/**
 * The one place an unknown thrown value becomes a user-facing line.
 *
 * The definition is shared in `lib/errors.ts`; this module keeps the
 * extension-local import path every WeChat notice and tool error uses.
 */

export { messageOf } from "../../lib/errors.ts";
