/**
 * `PanelComponent`'s probe lifecycle: the reports it re-reads on refresh, and
 * the doctor probing that fills the Extensions verdicts.
 */

import { describe, expect, test } from "bun:test";
import { buildPanel, enabledItem } from "../../../test/helpers/fixtures/bytefly.ts";
import { settle } from "../../../test/helpers/process.ts";

describe("PanelComponent refresh", () => {
	test("re-probes once on r and shows a busy hint", async () => {
		let finish: () => void = () => {};
		let refreshes = 0;
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			reports: [],
			refresh: () => {
				refreshes += 1;
				return new Promise<void>((resolve) => {
					finish = resolve;
				});
			},
		});

		component.handleInput("r");
		component.handleInput("r");
		expect(refreshes).toBe(1);
		expect(component.render(80).join("\n")).toContain("refreshing");
		finish();
		await settle();
		expect(component.render(80).join("\n")).not.toContain("refreshing");
	});

	test("surfaces a failed refresh as a notice and clears the busy state", async () => {
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			reports: [],
			refresh: () => Promise.reject(new Error("probe exploded")),
		});

		component.handleInput("r");
		await settle();

		const failed = component.render(80).join("\n");
		expect(failed).toContain("Could not refresh: probe exploded");
		expect(failed).not.toContain("refreshing");
		expect(failed).not.toContain("Esc close");

		component.handleInput("j");
		expect(component.render(80).join("\n")).toContain("Esc close");
	});
});

describe("PanelComponent probing", () => {
	test("primes once and shows the busy hint while it runs", async () => {
		const calls: boolean[] = [];
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			needsProbe: true,
			refresh: async (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		component.prime();
		expect(calls).toHaveLength(1);
		expect(component.render(80).join("\n")).toContain("refreshing");
		await settle();
		expect(calls).toEqual([false]);
		expect(component.render(80).join("\n")).not.toContain("refreshing");
	});

	test("waits for the first Extensions view", () => {
		const calls: boolean[] = [];
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			section: "settings",
			needsProbe: true,
			refresh: (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		expect(calls).toEqual([]);
		component.handleInput("\u001b[D");
		expect(calls).toEqual([]);
		component.handleInput("\u001b[D");
		expect(calls).toEqual([false]);
	});

	test("forces the first probe when the command asked to refresh", () => {
		const calls: boolean[] = [];
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			needsProbe: true,
			initialRefresh: true,
			refresh: (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		expect(calls).toEqual([true]);
	});

	test("does nothing without needsProbe", () => {
		const calls: boolean[] = [];
		const { component } = buildPanel({
			items: [enabledItem("plan")],
			refresh: (force) => {
				calls.push(force === true);
			},
		});

		component.prime();
		expect(calls).toEqual([]);
	});
});
