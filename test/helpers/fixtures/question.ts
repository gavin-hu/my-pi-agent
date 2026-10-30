/**
 * Fixture for the question suites.
 *
 * Both the data suite and the transcript suite drive the tool the extension really
 * registers, so they register it the same way and read the same entry out of the
 * host's map.
 */

import { createFakePi } from "../fakes.ts";
import { registerTools, TOOL_NAME } from "../../../extensions/question/tools.ts";

/** The `ask_user_question` tool as the host holds it after registration. */
export function registeredTool() {
	const { pi, tools } = createFakePi();
	registerTools(pi);
	return tools.get(TOOL_NAME);
}
