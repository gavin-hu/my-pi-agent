/**
 * Shared helpers for the guard test suite.
 */

export type AnyHandler = (...args: any[]) => any;

export interface FakeTool {
	name: string;
	annotations?: Record<string, unknown>;
}

/** Minimal `ExtensionAPI` double covering guard's surface. */
export function makeFakePi(tools: FakeTool[] = []) {
	const commands = new Map<string, any>();
	const handlers = new Map<string, AnyHandler[]>();

	const pi: any = {
		// `handlers` is exposed on the object so `emit()` can dispatch.
		handlers,
		registerCommand: (name: string, opts: any) => commands.set(name, opts),
		on: (event: string, handler: AnyHandler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		getAllTools: () => tools,
	};

	return { pi, commands, handlers };
}

export interface FakeCtx {
	ctx: any;
	notifications: string[];
	statuses: Array<{ key: string; text: unknown }>;
	setConfirm(value: boolean): void;
}

/** Minimal `ExtensionContext` double. */
export function fakeCtx(
	options: { cwd?: string; mode?: string; hasUI?: boolean; confirm?: boolean } = {},
): FakeCtx {
	const notifications: string[] = [];
	const statuses: Array<{ key: string; text: unknown }> = [];
	let confirmResult = options.confirm ?? true;

	const ctx: any = {
		cwd: options.cwd ?? process.cwd(),
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: (key: string, text: unknown) => statuses.push({ key, text }),
			confirm: async () => confirmResult,
			select: async () => undefined,
		},
	};

	return {
		ctx,
		notifications,
		statuses,
		setConfirm: (value: boolean) => {
			confirmResult = value;
		},
	};
}

export async function emit(pi: any, event: string, payload: unknown, ctx: any): Promise<any[]> {
	const results: any[] = [];
	for (const handler of pi.handlers.get(event) ?? []) results.push(await handler(payload, ctx));
	return results;
}

/** Build a `tool_call` payload. */
export function toolCall(toolName: string, input: Record<string, unknown>) {
	return { type: "tool_call", toolCallId: "t1", toolName, input };
}
