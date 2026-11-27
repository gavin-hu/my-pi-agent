/**
 * The update check's notice, as its cases read it.
 *
 * The notice is the shared one (`lib/notice.ts`), so the shape comes from there rather than from a
 * local copy: a field the notice gains reaches this fixture, and a case that prints one asserts on
 * the renderer-facing details the notice actually carries.
 */

import { expect } from "bun:test";
import type { NoticeDetails } from "../../../lib/notice.ts";

/** The message a surface posted, with the notice details the update check builds. */
export interface UpdateNotice {
	customType: string;
	content: string;
	details: NoticeDetails & {
		items: Array<{ label: string; detail: string; severity: string }>;
	};
}

/** The notice the surface posted, when there is exactly one. */
export function noticeOf(customMessages: Array<{ message: UpdateNotice }>): UpdateNotice {
	expect(customMessages).toHaveLength(1);
	return customMessages[0].message;
}
