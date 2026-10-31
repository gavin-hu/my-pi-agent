/**
 * One refusal for the folded `plan` tool.
 *
 * A rejected action says what it needed and carries the same words in `details`,
 * so the transcript draws the reason rather than a bare rejected-call envelope.
 * Every refusal happens before the first write, so a rejected call leaves the
 * plan mode and the plan file exactly as they were.
 */

import { failedResult, type ToolFailure } from "../../../lib/tool-result.ts";
import type { PlanAction, RefusedPlanDetails } from "../types.ts";

export function planRefusal<Action extends PlanAction>(
	action: Action,
	message: string,
): ToolFailure<RefusedPlanDetails> {
	return failedResult(`Error: ${message}`, { refused: action, error: message });
}
