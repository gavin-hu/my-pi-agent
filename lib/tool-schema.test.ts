/**
 * The enumerated parameter schema: pi-ai's own JSON Schema, and a parameter that
 * infers as the union of its values rather than as `unknown`.
 */

import { describe, expect, test } from "bun:test";
import { StringEnum as hostStringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { StringEnum } from "./tool-schema.ts";

const ACTIONS = ["enter", "cancel"] as const;

/** A schema as the JSON Schema it is, which is what the model's tool declaration carries. */
function json(schema: unknown): unknown {
	return JSON.parse(JSON.stringify(schema));
}

const Params = Type.Object({
	action: StringEnum(ACTIONS, { description: "What to do." }),
	note: Type.Optional(Type.String()),
});

describe("StringEnum", () => {
	test("writes the schema pi-ai writes, so no tool call changes", () => {
		expect(json(StringEnum(ACTIONS))).toEqual(json(hostStringEnum(ACTIONS)));
		expect(json(StringEnum(ACTIONS, { description: "Pick one.", default: "enter" }))).toEqual(
			json(hostStringEnum(ACTIONS, { description: "Pick one.", default: "enter" })),
		);
		expect(json(StringEnum(ACTIONS))).toEqual({ type: "string", enum: ["enter", "cancel"] });
	});

	test("a parameter declared with it infers the union, not unknown", () => {
		const params: Static<typeof Params> = { action: "enter" };
		// The assignment is the assertion: a lost union makes this line fail to compile.
		const action: (typeof ACTIONS)[number] = params.action;
		expect(action).toBe("enter");
	});
});
