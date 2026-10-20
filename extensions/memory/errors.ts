/**
 * Error-text extraction shared by the memory tool and the `/memory` command.
 *
 * The single definition lives in `lib/errors.ts`; this module keeps the
 * extension-local import path used by the tool, command, and picker.
 */

export { messageOf } from "../../lib/errors.ts";
