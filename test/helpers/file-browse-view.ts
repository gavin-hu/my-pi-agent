/**
 * The browse pages' fixtures: the root label, the tree, and the two shapers a page case needs.
 *
 * Two suites read the same rendered pages now — `view/pages.test.ts` for the document and its
 * content, and `view/chrome.test.ts` for the toolbar, the live chip, and the footer — so the
 * tree and the listing shaper live here, where each has one owner instead of two copies that
 * drift the first time a page gains a field.
 */

import type { DirEntry, Listing, TreeNode } from "../../extensions/file-browse/files/files.ts";
import { type DirectoryPage, renderDirectoryPage } from "../../extensions/file-browse/view/html.ts";

/** The served root the pages print in their header and footer. */
export const ROOT_LABEL = "/srv/aurora";

/** One fixed stamp: a page prints dates, and a test that read the wall clock would drift. */
export const MTIME_MS = 1_700_000_000_000;

/** The tree every page case draws: a folder, a file inside it, and a name that needs escaping. */
export const TREE: TreeNode = {
	name: "root",
	rel: "",
	isDir: true,
	isImage: false,
	broken: false,
	kind: "directory",
	children: [
		{
			name: "sub",
			rel: "sub",
			isDir: true,
			isImage: false,
			broken: false,
			kind: "directory",
			children: [
				{ name: "b.md", rel: "sub/b.md", isDir: false, isImage: false, broken: false, kind: "text", children: [] },
			],
		},
		{ name: 'a"<b>.txt', rel: 'a"<b>.txt', isDir: false, isImage: false, broken: false, kind: "text", children: [] },
	],
};

/** One entry of a listing, with the fields a page reads defaulted. */
export function dirEntry(overrides: Partial<DirEntry> & Pick<DirEntry, "name" | "rel">): DirEntry {
	return {
		isDir: false,
		isSymlink: false,
		broken: false,
		size: 1,
		mtimeMs: MTIME_MS,
		kind: "text",
		isImage: false,
		...overrides,
	};
}

/** One folder listing, sized like the server sends it. */
export function listing(entries: DirEntry[], total = entries.length, truncated = false): Listing {
	return { entries, total, truncated };
}

/** One folder page, so a case reads as the page it is about. */
export function directoryPage(overrides: Partial<DirectoryPage> = {}): string {
	return renderDirectoryPage({
		base: "",
		rootLabel: ROOT_LABEL,
		rel: "",
		listing: listing([]),
		tree: TREE,
		thumbnails: false,
		maxThumbBytes: 0,
		...overrides,
	});
}
