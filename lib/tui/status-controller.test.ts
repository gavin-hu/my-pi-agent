import { describe, expect, test } from "bun:test";
import { coloringTheme, fakeTheme } from "../../test/helpers/fakes.ts";
import { createStatusController, type StatusChip } from "./status-controller.ts";

/** A context whose UI records the statuses it is given. */
function makeContext(theme: unknown = fakeTheme) {
	const statuses = new Map<string, string | undefined>();
	const target = {
		ui: {
			theme,
			setStatus: (key: string, value: string | undefined) => {
				if (value === undefined) statuses.delete(key);
				else statuses.set(key, value);
			},
		},
	};
	return { target: target as any, statuses };
}

const chips = (): StatusChip[] => [
	{ key: "running", glyph: "▸", count: 2, role: "accent" },
	{ key: "failed", glyph: "✗", count: 0, role: "bad" },
];

describe("createStatusController", () => {
	test("no-ops until a context is attached", () => {
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips });
		controller.setStatus();
		controller.paint();
		expect(true).toBe(true);
	});

	test("publishes each chip and clears a zero count", () => {
		const { target, statuses } = makeContext();
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => true, chips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		expect(statuses.has("failed")).toBe(false);
	});

	test("paints through the theme's role", () => {
		const { target, statuses } = makeContext(coloringTheme);
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("[accent]▸ 2");
	});

	test("an unavailable theme falls back to plain text", () => {
		const broken: any = {};
		broken.fg = () => {
			throw new Error("no theme");
		};
		const { target, statuses } = makeContext(broken);
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
	});

	test("a disabled controller clears every key it owns", () => {
		const { target, statuses } = makeContext();
		let enabled = true;
		const controller = createStatusController({ keys: ["running", "failed"], enabled: () => enabled, chips });
		controller.setStatus(target);
		expect(statuses.get("running")).toBe("▸ 2");
		enabled = false;
		controller.paint();
		expect(statuses.has("running")).toBe(false);
		expect(statuses.has("failed")).toBe(false);
	});

	test("detach stops publishing", () => {
		const { target, statuses } = makeContext();
		const controller = createStatusController({ keys: ["running"], enabled: () => true, chips });
		controller.setStatus(target);
		controller.detach();
		statuses.clear();
		controller.paint();
		expect(statuses.size).toBe(0);
	});
});
