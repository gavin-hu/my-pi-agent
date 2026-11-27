/**
 * The footer status controller: `attach` / `setStatus` / `paint` / `notify` / `detach`
 * over a UI that records what it is told.
 *
 * Split from `interaction.test.ts` when a case there needed a line and the suite was at
 * its named height: one module's lifecycle, one suite, which is what the ratchet in
 * `test/suite-sizes.test.ts` asks for rather than a raised number.
 */

import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { createStatusController, type StatusChip } from "./status-controller.ts";

interface RecordingUi {
	theme: unknown;
	setStatus(key: string, value: string | undefined): void;
	notify(text: string, severity: string): void;
}

/** A context whose UI records the statuses and notifications it is given. */
function statusContext(theme: unknown = fakeTheme): {
	target: ExtensionContext;
	statuses: Map<string, string | undefined>;
	notices: Array<{ text: string; severity: string }>;
} {
	const statuses = new Map<string, string | undefined>();
	const notices: Array<{ text: string; severity: string }> = [];
	const ui: RecordingUi = {
		theme,
		setStatus: (key, value) => {
			if (value === undefined) statuses.delete(key);
			else statuses.set(key, value);
		},
		notify: (text, severity) => {
			notices.push({ text, severity });
		},
	};
	return { target: { ui } as unknown as ExtensionContext, statuses, notices };
}

function statusChips(): StatusChip[] {
	return [
		{ key: "running", glyph: "▸", count: 2, role: "accent" },
		{ key: "failed", glyph: "✗", count: 0, role: "bad" },
	];
}

describe("createStatusController", () => {
	test("no-ops until a context is attached", () => {
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips: statusChips });
		expect(() => {
			controller.setStatus();
			controller.paint();
		}).not.toThrow();
	});

	test("publishes each chip and clears a zero count", () => {
		const { target, statuses } = statusContext();
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		expect(statuses.has("failed")).toBe(false);
	});

	test("paints through the theme's role", () => {
		const { target, statuses } = statusContext(coloringTheme);
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("[accent]▸ 2");
	});

	test("an unavailable theme falls back to plain text", () => {
		const broken: Record<string, unknown> = {};
		broken.fg = () => {
			throw new Error("no theme");
		};
		const { target, statuses } = statusContext(broken);
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
	});

	test("a disabled controller clears every key it owns", () => {
		const { target, statuses } = statusContext();
		let enabled = true;
		const controller = createStatusController({
			keys: ["running", "failed"],
			enabled: () => enabled,
			chips: statusChips,
		});
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		enabled = false;
		controller.paint();
		expect(statuses.has("running")).toBe(false);
		expect(statuses.has("failed")).toBe(false);
	});

	test("detach clears the keys it owns and stops publishing", () => {
		const { target, statuses } = statusContext();
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		controller.detach();
		// A detached controller cannot repaint, so it must not leave a stale chip.
		expect(statuses.has("running")).toBe(false);
		controller.paint();
		expect(statuses.size).toBe(0);
	});

	test("detach survives a UI that is already gone", () => {
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		const broken = {
			ui: {
				theme: fakeTheme,
				setStatus: () => {
					throw new Error("gone");
				},
			},
		};
		controller.setStatus(broken as unknown as ExtensionContext);
		expect(() => controller.detach()).not.toThrow();
	});
});

describe("createStatusController notify", () => {
	test("routes a notification through the attached context", () => {
		const { target, notices } = statusContext();
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		controller.notify("Job j1 failed", "error");
		expect(notices).toEqual([{ text: "Job j1 failed", severity: "error" }]);
	});

	test("no-ops without a context, so a non-interactive mode needs no guard", () => {
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		expect(() => controller.notify("Job j1 failed", "error")).not.toThrow();
	});

	test("swallows a UI that throws", () => {
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		const broken = {
			ui: {
				theme: fakeTheme,
				notify: () => {
					throw new Error("gone");
				},
			},
		};
		controller.attach(broken as unknown as ExtensionContext);
		expect(() => controller.notify("Job j1 failed", "error")).not.toThrow();
	});

	test("stops notifying after detach", () => {
		const { target, notices } = statusContext();
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips: statusChips });
		controller.setStatus(target);
		controller.detach();
		controller.notify("Job j1 failed", "error");
		expect(notices).toEqual([]);
	});
});
