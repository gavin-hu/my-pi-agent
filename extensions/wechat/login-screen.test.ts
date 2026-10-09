import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { fakeTheme } from "../../test/helpers/fakes.ts";
import { LoginScreenComponent, loginBody, statusLabel } from "./login-screen.ts";

describe("statusLabel", () => {
	test("maps a known status and passes an unknown one through", () => {
		expect(statusLabel("wait")).toContain("Waiting");
		expect(statusLabel("mystery")).toBe("mystery");
	});
});

describe("loginBody", () => {
	test("shows the QR when it fits the width", () => {
		const body = loginBody({ status: "wait", lines: ["██", "██"], url: "" }, 10);
		expect(body).toContain("██");
	});

	test("falls back to URL chunks when the QR is too wide", () => {
		const body = loginBody({ status: "wait", lines: ["XXXXX"], url: "abcdefgh" }, 4);
		expect(body).toContain("abcd");
		expect(body).toContain("efgh");
	});

	test("shows an error instead of the status", () => {
		expect(loginBody({ status: "wait", lines: [], url: "", error: "boom" }, 20)).toContain("boom");
	});
});

describe("LoginScreenComponent", () => {
	test("calls onCancel on escape", () => {
		let cancelled = false;
		const component = new LoginScreenComponent({
			theme: fakeTheme,
			state: () => ({ status: "wait", lines: [], url: "" }),
			onCancel: () => {
				cancelled = true;
			},
			requestRender: () => {},
		});
		component.handleInput("\u001b");
		expect(cancelled).toBe(true);
	});

	test("renders lines that fit the width", () => {
		const component = new LoginScreenComponent({
			theme: fakeTheme,
			state: () => ({ status: "wait", lines: ["██"], url: "" }),
			onCancel: () => {},
			requestRender: () => {},
		});
		for (const line of component.render(12)) expect(visibleWidth(line)).toBeLessThanOrEqual(12);
	});
});
