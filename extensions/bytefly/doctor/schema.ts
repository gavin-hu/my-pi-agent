/**
 * Parameter and output schema for `run_doctor`.
 *
 * Pure: no host APIs. The output schema mirrors the structured report the tool
 * returns, so a caller can read the findings as data instead of parsing text.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

/** Tool name, exported here so the naming guard imports one constant. */
export const TOOL_NAME = "run_doctor";

export const SEVERITIES = ["ok", "missing", "degraded", "info"] as const;

export const DoctorParams = Type.Object({
	extension: Type.Optional(
		Type.String({
			description: "Report a single extension instead of every extension.",
		}),
	),
	refresh: Type.Optional(
		Type.Boolean({
			description: "Ignore the findings cached earlier in this session and probe again.",
		}),
	),
});

export type DoctorArgs = Static<typeof DoctorParams>;

const FindingSchema = Type.Object({
	check: Type.String({ description: "The binary, package, file, or note that was checked." }),
	severity: StringEnum(SEVERITIES, { description: "ok, missing, degraded, or info." }),
	detail: Type.String({ description: "What was found, or what the check covers when it passed." }),
	hint: Type.Optional(Type.String({ description: "What to do about it." })),
});

const ExtensionReportSchema = Type.Object({
	extension: Type.String(),
	enabled: Type.Boolean({ description: "False when the extension is disabled for this session." }),
	findings: Type.Array(FindingSchema),
});

export const DoctorOutput = Type.Object({
	headline: Type.String({ description: "One-line summary of the report." }),
	missing: Type.Number({ description: "Findings that stop an enabled extension working." }),
	degraded: Type.Number({ description: "Findings that reduce what an extension can do." }),
	extensions: Type.Array(ExtensionReportSchema),
});

export type DoctorStructured = Static<typeof DoctorOutput>;
