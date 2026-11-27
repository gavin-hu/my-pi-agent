/**
 * The shape of the tool surface: every bound is in the schema, and every enum is a plain
 * string enum.
 *
 * Pi validates a call against the parameter schema before `execute`, so a bound written
 * there is refused by the host and reads in the definition the model gets every request;
 * a bound only the runtime holds is discovered by a failed call, which is a round trip the
 * model had no way to avoid. `board` and `team` published `anyOf`/`const` unions until
 * #748, the form `lib/tool-schema.ts:1-33` documents as the one a provider that supports
 * neither cannot express.
 *
 * The walk is the *registered* surface, loaded through the fake runtime the way
 * `extension-load.test.ts` loads it: a schema exported but never wired into
 * `registerTool` is a schema the model never receives, and a hand list of schemas would
 * pass it. `REGISTERED` (`helpers/registry.ts`) is the one name list, so a tool that is
 * named and documented cannot go missing here.
 */

import { describe, expect, test } from "bun:test";
import { MAX_BLOCKED } from "../lib/workflow/block.ts";
import { MAX_DEPENDS, MAX_NOTE, MAX_PATH, MAX_PATHS, MAX_PLAN, MAX_TITLE } from "../lib/workflow/card.ts";
import { MAX_CONTRACT } from "../lib/workflow/contract.ts";
import { HEADER_MAX_WIDTH } from "../extensions/question/schema.ts";
import { MAX_STEPS } from "../extensions/plan/steps.ts";
import { MESSAGE_FIELDS } from "../extensions/wechat/tools.ts";
import { MAX_ENTRY_CHARS } from "../extensions/memory/schema.ts";
import { MAX_LABEL as JOB_LABEL, MAX_COMMAND, MAX_STDIN } from "../extensions/job/schema.ts";
import { MAX_WAIT_MS } from "../extensions/job/waiters.ts";
import { MAX_LABEL as WATCH_LABEL, MAX_EXCLUDE, MAX_PATTERN, MAX_SOURCE } from "../extensions/watch/schema.ts";
import { MAX_LABEL } from "../lib/session-label.ts";
import { MAX_PATHS as MAX_SESSION_PATHS, MIN_PATHS } from "../extensions/session-bus/protocol.ts";
import { MAX_CONTENT } from "../lib/todo-state.ts";
import { MAX_OBJECTIVE } from "../extensions/goal/schema.ts";
import { MAX_MESSAGE_TEXT } from "../lib/session-tool.ts";
import { MAX_BODY_CHARS } from "../extensions/web-access/fetch/config.ts";
import { MAX_HEADERS, MAX_HEADER_VALUE, MAX_URL_LENGTH } from "../extensions/web-access/fetch/schema.ts";
import { REGISTERED } from "./helpers/registry.ts";
import { registeredTools, type SchemaNode } from "./helpers/registered.ts";

/** One schema node and where it sits, as `paths[items]` reads. */
type Walked = { at: string; node: SchemaNode };

/** Every node of `node`, keeping the path a failure can name. */
function nodes(node: SchemaNode, at = "", out: Walked[] = []): Walked[] {
	out.push({ at, node });
	for (const [key, child] of Object.entries(node.properties ?? {})) {
		nodes(child, at === "" ? key : `${at}.${key}`, out);
	}
	if (node.items !== undefined) nodes(node.items, `${at}[items]`, out);
	if (typeof node.additionalProperties === "object") nodes(node.additionalProperties, `${at}[value]`, out);
	for (const [name, child] of Object.entries(node.patternProperties ?? {})) {
		nodes(child, `${at}[${name}]`, out);
	}
	return out;
}

/** One bound a schema is expected to carry, and where the value comes from. */
interface Carried {
	tool: string;
	at: string;
	bound: "maxLength" | "maxItems" | "minItems" | "minProperties" | "maxProperties";
	value: number;
}

/**
 * Every bound this package enforces, read from the constant that owns it.
 *
 * A raise in one of those constants now fails here rather than stranding the schema, which
 * is the half a hand-kept schema loses one field at a time.
 */
const CARRIED: readonly Carried[] = [
	// The object's own count, `at` empty: one message is exactly one of `text`, `image`, and `file`.
	{ tool: "send_wechat", at: "", bound: "minProperties", value: MESSAGE_FIELDS },
	{ tool: "send_wechat", at: "", bound: "maxProperties", value: MESSAGE_FIELDS },
	// The tab header's clip, published: a header past it is refused rather than shortened.
	{ tool: "question", at: "questions[items].header", bound: "maxLength", value: HEADER_MAX_WIDTH },
	// Approval tracks at most this many steps, so one batch sets at most this many.
	{ tool: "plan", at: "updates", bound: "maxItems", value: MAX_STEPS },
	{ tool: "board", at: "title", bound: "maxLength", value: MAX_TITLE },
	{ tool: "board", at: "note", bound: "maxLength", value: MAX_NOTE },
	{ tool: "board", at: "blockedBy", bound: "maxLength", value: MAX_BLOCKED },
	{ tool: "board", at: "path", bound: "maxLength", value: MAX_PLAN },
	{ tool: "board", at: "override", bound: "maxLength", value: MAX_CONTRACT },
	{ tool: "board", at: "landed", bound: "maxLength", value: 40 },
	{ tool: "board", at: "goal", bound: "maxLength", value: MAX_CONTRACT },
	{ tool: "board", at: "acceptance", bound: "maxLength", value: MAX_CONTRACT },
	{ tool: "board", at: "scopeOut", bound: "maxLength", value: MAX_CONTRACT },
	{ tool: "board", at: "verify", bound: "maxLength", value: MAX_CONTRACT },
	{ tool: "board", at: "paths", bound: "maxItems", value: MAX_PATHS },
	{ tool: "board", at: "paths[items]", bound: "maxLength", value: MAX_PATH },
	{ tool: "board", at: "dependsOn", bound: "maxItems", value: MAX_DEPENDS },
	// One item's text on either half of a todo, and the objective the goal tool refuses past.
	{ tool: "todo", at: "todos[items].content", bound: "maxLength", value: MAX_CONTENT },
	{ tool: "todo", at: "todos[items].activeForm", bound: "maxLength", value: MAX_CONTENT },
	{ tool: "goal", at: "objective", bound: "maxLength", value: MAX_OBJECTIVE },
	{ tool: "team", at: "to", bound: "maxLength", value: MAX_LABEL },
	{ tool: "team", at: "note", bound: "maxLength", value: MAX_MESSAGE_TEXT },
	{ tool: "team", at: "question", bound: "maxLength", value: MAX_MESSAGE_TEXT },
	{ tool: "session", at: "paths", bound: "minItems", value: MIN_PATHS },
	{ tool: "session", at: "paths", bound: "maxItems", value: MAX_SESSION_PATHS },
	{ tool: "session", at: "text", bound: "maxLength", value: MAX_MESSAGE_TEXT },
	{ tool: "session", at: "to", bound: "maxLength", value: MAX_LABEL },
	{ tool: "session", at: "label", bound: "maxLength", value: MAX_LABEL },
	{ tool: "job", at: "command", bound: "maxLength", value: MAX_COMMAND },
	{ tool: "job", at: "label", bound: "maxLength", value: JOB_LABEL },
	{ tool: "job", at: "input", bound: "maxLength", value: MAX_STDIN },
	{ tool: "watch", at: "path", bound: "maxLength", value: MAX_SOURCE },
	{ tool: "watch", at: "command", bound: "maxLength", value: MAX_SOURCE },
	{ tool: "watch", at: "pattern", bound: "maxLength", value: MAX_PATTERN },
	{ tool: "watch", at: "label", bound: "maxLength", value: WATCH_LABEL },
	{ tool: "watch", at: "exclude", bound: "maxItems", value: MAX_EXCLUDE },
	{ tool: "watch", at: "exclude[items]", bound: "maxLength", value: MAX_PATTERN },
	{ tool: "memory", at: "to", bound: "maxLength", value: MAX_ENTRY_CHARS },
	{ tool: "memory", at: "merged", bound: "maxLength", value: MAX_ENTRY_CHARS },
	// `web_fetch`'s three constants, and the body's installable ceiling: the enforced body cap is a
	// project's `fetch.maxBodyChars`, which no schema can state at registration, so the schema publishes
	// the widest body it can accept and the description names the configured one (#898).
	{ tool: "web_fetch", at: "url", bound: "maxLength", value: MAX_URL_LENGTH },
	{ tool: "web_fetch", at: "body", bound: "maxLength", value: MAX_BODY_CHARS },
	{ tool: "web_fetch", at: "headers", bound: "maxProperties", value: MAX_HEADERS },
	{ tool: "web_fetch", at: "headers[value]", bound: "maxLength", value: MAX_HEADER_VALUE },
];

/**
 * The two caps a schema cannot state, and the sentence that carries them instead.
 *
 * `memory.text` is a selector for `update` and `forget` as well as the note `add` writes,
 * and `schema.ts:89-96` records why capping it would strand a hand-edited note;
 * `job.timeoutMs` is a ceiling for `wait` and a floor of 1 for `start`, so one number
 * cannot be the field's bound. Each stays in its own description, naming its verb.
 */
const PROSE_ONLY: readonly { tool: string; at: string; value: number }[] = [
	{ tool: "memory", at: "text", value: MAX_ENTRY_CHARS },
	{ tool: "job", at: "timeoutMs", value: MAX_WAIT_MS },
];

describe("the tool surface's schema", () => {
	test("every tool named in the registry is registered, and every registered tool is named", async () => {
		const live = (await registeredTools()).map((tool) => tool.name).sort();
		expect(live).toEqual(REGISTERED.map((entry) => entry.name).sort());
	});

	test("no parameter schema publishes anyOf or const, the form a provider may not support", async () => {
		const offenders: string[] = [];
		for (const tool of await registeredTools()) {
			if (tool.parameters === undefined) continue;
			for (const { at, node } of nodes(tool.parameters)) {
				if (node.anyOf !== undefined) offenders.push(`${tool.name}${at === "" ? "" : `.${at}`}: anyOf`);
				if (node.const !== undefined) offenders.push(`${tool.name}${at === "" ? "" : `.${at}`}: const`);
			}
		}
		expect(offenders, "use StringEnum from lib/tool-schema.ts").toEqual([]);
	});

	test("every carried bound is the constant that owns it", async () => {
		const offenders: string[] = [];
		for (const { tool, at, bound, value } of CARRIED) {
			const registration = (await registeredTools()).find((candidate) => candidate.name === tool);
			const node = nodes(registration?.parameters ?? {}).find((walked) => walked.at === at)?.node;
			if (node === undefined) {
				offenders.push(`${tool}.${at}: no such parameter`);
				continue;
			}
			if (node[bound] !== value) offenders.push(`${tool}.${at}.${bound}: ${String(node[bound])}, expected ${value}`);
			// Said once, where it is enforced: a description that still spells the number is the
			// copy that drifts when the constant moves, and the schema already states it.
			if ((node.description ?? "").includes(`≤${value}`)) {
				offenders.push(`${tool}.${at}: the description restates the ${bound} the schema carries`);
			}
		}
		expect(offenders, "read the cap from the constant instead of writing the number").toEqual([]);
	});

	test("the two caps the schema cannot state are stated where they are read", async () => {
		const offenders: string[] = [];
		for (const { tool, at, value } of PROSE_ONLY) {
			const registration = (await registeredTools()).find((candidate) => candidate.name === tool);
			const node = nodes(registration?.parameters ?? {}).find((walked) => walked.at === at)?.node;
			if (node === undefined) {
				offenders.push(`${tool}.${at}: no such parameter`);
				continue;
			}
			if (node.maxLength !== undefined) {
				offenders.push(`${tool}.${at}: carries maxLength ${node.maxLength}, so it is not prose-only`);
			}
			if (!(node.description ?? "").includes(String(value))) {
				offenders.push(`${tool}.${at}: its description does not state ${value}`);
			}
		}
		expect(offenders, "a prose-only cap names its number in the description").toEqual([]);
	});
});
