/**
 * Registers bytefly's renderer for the shared transcript notice.
 *
 * Registration happens at extension load, like the turn separator's entry
 * renderer: a message renderer only matters where a transcript renders, so no
 * session lifecycle is needed. Pi resolves it by the exact `NOTICE_TYPE`;
 * without one it would fall back to its default custom-message box.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { NOTICE_TYPE, type NoticeDetails } from "../../../lib/notice.ts";
import { NoticeComponent } from "./component.ts";

/** Register the notice renderer; a message without details keeps Pi's default. */
export function registerNotice(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<NoticeDetails>(NOTICE_TYPE, (message, _options, theme) =>
		message.details ? new NoticeComponent(message.details, theme) : undefined,
	);
}
