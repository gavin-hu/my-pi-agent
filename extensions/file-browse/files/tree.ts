/**
 * The sidebar tree: the current path's ancestors expanded, siblings collapsed.
 *
 * Its rows are the same `DirEntry` a listing produces, so the tree and the listing cannot
 * disagree about what one name is.
 */

import { basename } from "node:path";
import type { EntryKind } from "./classify.ts";
import { type Listing, listDirectory } from "./list.ts";

export interface TreeNode {
	name: string;
	rel: string;
	isDir: boolean;
	isImage: boolean;
	/** True for a symlink whose target cannot be resolved. */
	broken: boolean;
	kind: EntryKind;
	children: TreeNode[];
}

/**
 * Build the sidebar tree: the current path's ancestors are expanded so the
 * active item is always visible, and siblings are shown collapsed.
 */
export async function buildTree(root: string, currentRel: string, limit: number): Promise<TreeNode> {
	return buildNode(root, "", currentRel, basename(root) || root, limit);
}

/** A directory page's two views of one directory. */
export interface DirectoryView {
	/** The current directory's own rows, for the page's listing. */
	listing: Listing;
	/** The sidebar tree, with the current path expanded. */
	tree: TreeNode;
}

/**
 * One walk for a directory page: the listing it draws, and the tree that shows
 * where it sits.
 *
 * `listDirectory` is what decides whether the directory can be read at all, so it
 * runs first and its 404 is the page's error. The walk then reuses that listing
 * for the same directory instead of reading it a second time; the ancestors are
 * still read once each, which is what the tree needs.
 */
export async function directoryView(root: string, currentRel: string, limit: number): Promise<DirectoryView> {
	const listing = await listDirectory(root, currentRel, limit);
	const tree = await buildNode(root, "", currentRel, basename(root) || root, limit, { rel: currentRel, listing });
	return { listing, tree };
}

async function buildNode(
	root: string,
	relDir: string,
	currentRel: string,
	label: string,
	limit: number,
	/** A listing the caller already read for this directory, so it is not re-read. */
	known?: { rel: string; listing: Listing },
): Promise<TreeNode> {
	const node: TreeNode = {
		name: label,
		rel: relDir,
		isDir: true,
		isImage: false,
		broken: false,
		kind: "directory",
		children: [],
	};
	let listing: Listing;
	if (known && known.rel === relDir) {
		listing = known.listing;
	} else {
		try {
			listing = await listDirectory(root, relDir, limit);
		} catch {
			return node;
		}
	}
	for (const entry of listing.entries) {
		const child: TreeNode = {
			name: entry.name,
			rel: entry.rel,
			isDir: entry.isDir,
			isImage: entry.isImage,
			broken: entry.broken,
			kind: entry.kind,
			children: [],
		};
		if (entry.isDir) {
			const onPath = currentRel === entry.rel || currentRel.startsWith(`${entry.rel}/`);
			if (onPath) {
				child.children = (await buildNode(root, entry.rel, currentRel, entry.name, limit, known)).children;
			}
		}
		node.children.push(child);
	}
	return node;
}
