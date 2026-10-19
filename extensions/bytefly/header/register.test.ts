import { describe, expect, test } from "bun:test";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { emit, fakeTheme, makeFakePi } from "../../../test/helpers/fakes.ts";
import { registerHeader } from "./register.ts";
import { createUpdateState } from "../update/state.ts";

/** Boot the header surface and record every `setHeader` call. */
function boot(settings: Record<string, unknown>, mode = "tui") {
	const { pi } = makeFakePi({ settings });
	const headers: Array<unknown> = [];
	const { ctx } = fakeCtx({ mode });
	ctx.ui.setHeader = (factory: unknown) => {
		headers.push(factory);
	};
	const updates = createUpdateState();
	const handle = registerHeader(pi, updates);
	return { pi, ctx, headers, updates, handle };
}

/** Render the last installed header at 80 columns. */
function renderLast(headers: unknown[]): string[] {
	const factory = headers.at(-1) as ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined;
	if (typeof factory !== "function") return [];
	return factory({}, fakeTheme).render(80);
}

describe("header lifecycle", () => {
	test("installs the custom header when the bytefly startup TUI is on", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: true });

		await emit(pi, "session_start", {}, ctx);

		expect(typeof headers.at(-1)).toBe("function");
	});

	test("leaves Pi's built-in header for a normal startup", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: false });

		await emit(pi, "session_start", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});

	test("leaves Pi's built-in header when quietStartup only keeps the header", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: "header" });

		await emit(pi, "session_start", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});

	test("leaves Pi's built-in header when quietStartup is unset", async () => {
		const { pi, ctx, headers } = boot({});

		await emit(pi, "session_start", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});

	test("does nothing outside the interactive mode", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: true }, "print");

		await emit(pi, "session_start", {}, ctx);

		expect(headers).toEqual([]);
	});

	test("restores the built-in header on shutdown", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		await emit(pi, "session_shutdown", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});
});

describe("header update marker", () => {
	test("renders no marker until a newer version is known", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		expect(renderLast(headers)[2]).not.toContain("↑");
	});

	test("re-installs the header with the marker once the store holds a version", async () => {
		const { pi, ctx, headers, updates, handle } = boot({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);

		updates.set([], "0.12.0");
		handle.refresh();

		expect(headers).toHaveLength(2);
		expect(renderLast(headers)[2]).toContain("↑0.12.0");
	});

	test("does nothing on refresh before a session started", () => {
		const { headers, handle } = boot({ quietStartup: true });

		handle.refresh();

		expect(headers).toEqual([]);
	});

	test("does nothing on refresh after shutdown", async () => {
		const { pi, ctx, headers, updates, handle } = boot({ quietStartup: true });
		await emit(pi, "session_start", {}, ctx);
		await emit(pi, "session_shutdown", {}, ctx);
		const installed = headers.length;

		updates.set([], "0.12.0");
		handle.refresh();

		expect(headers).toHaveLength(installed);
	});
});
