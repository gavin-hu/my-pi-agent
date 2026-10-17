import { describe, expect, test } from "bun:test";
import { emit, makeFakePi } from "../../../test/helpers/fakes.ts";
import { fakeCtx } from "../../../test/helpers/context.ts";
import { registerHeader } from "./register.ts";

/** Boot the header surface and record every `setHeader` call. */
function boot(settings: Record<string, unknown>, mode = "tui") {
	const { pi } = makeFakePi({ settings });
	const headers: Array<unknown> = [];
	const { ctx } = fakeCtx({ mode });
	ctx.ui.setHeader = (factory: unknown) => {
		headers.push(factory);
	};
	registerHeader(pi);
	return { pi, ctx, headers };
}

describe("header lifecycle", () => {
	test("installs the custom header for a normal startup", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: false });

		await emit(pi, "session_start", {}, ctx);

		expect(typeof headers.at(-1)).toBe("function");
	});

	test("installs the custom header when quietStartup only keeps the header", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: "header" });

		await emit(pi, "session_start", {}, ctx);

		expect(typeof headers.at(-1)).toBe("function");
	});

	test("restores the built-in header under quietStartup: true", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: true });

		await emit(pi, "session_start", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});

	test("does nothing outside the interactive mode", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: false }, "print");

		await emit(pi, "session_start", {}, ctx);

		expect(headers).toEqual([]);
	});

	test("restores the built-in header on shutdown", async () => {
		const { pi, ctx, headers } = boot({ quietStartup: false });
		await emit(pi, "session_start", {}, ctx);

		await emit(pi, "session_shutdown", {}, ctx);

		expect(headers.at(-1)).toBeUndefined();
	});
});
