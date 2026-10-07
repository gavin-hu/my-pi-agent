/** Shared types for the guard extension. */

export type GuardKind = "path" | "command" | "annotation";

export type GuardAction = "allow" | "confirm" | "block";

export type GuardVerdict =
	| { action: "allow" }
	| {
			action: "confirm" | "block";
			reason: string;
			kind: GuardKind;
			/** Stable identity used for per-session confirmation memory. */
			detail: string;
	  };
