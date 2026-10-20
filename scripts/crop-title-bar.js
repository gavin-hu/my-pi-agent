/**
 * Crop Terminal's title bar off a window capture.
 *
 * `screencapture -l` includes the title bar, whose last segment is the foreground
 * process's argv: the capture command's own path and environment. No Terminal
 * profile switch turns that segment off, and `screencapture -R` would crop it by
 * reading the screen instead of the window, so a window in front would land in
 * the image. This runs under `osascript -l JavaScript`, which is part of macOS,
 * so the docs script needs no extra tooling to take the strip off.
 *
 *   osascript -l JavaScript scripts/crop-title-bar.js <source> <target> <window width in points> <title bar in points>
 *
 * `CGImageCreateWithImageInRect` measures from the image's top-left corner, which
 * is the strip to remove; the capture is in device pixels, so the point
 * measurements are scaled by the capture's width.
 */

ObjC.import("AppKit");
ObjC.import("ImageIO");

function run(argv) {
	const [source, target, windowWidth, titleBar] = argv;
	const url = $.NSURL.fileURLWithPath(source);
	const imageSource = $.CGImageSourceCreateWithURL(url, $());
	if (!imageSource) throw new Error(`cannot read ${source}`);
	const image = $.CGImageSourceCreateImageAtIndex(imageSource, 0, $());
	if (!image) throw new Error(`cannot decode ${source}`);

	const width = $.CGImageGetWidth(image);
	const height = $.CGImageGetHeight(image);
	const scale = width / Number(windowWidth);
	if (!Number.isFinite(scale) || scale <= 0) throw new Error(`cannot scale ${source} against ${windowWidth}pt`);
	const top = Math.round(Number(titleBar) * scale);
	if (!Number.isFinite(top) || top <= 0 || top >= height) {
		throw new Error(`cannot crop ${titleBar}pt off a ${height}px capture`);
	}

	const cropped = $.CGImageCreateWithImageInRect(image, $.CGRectMake(0, top, width, height - top));
	if (!cropped) throw new Error(`cannot crop ${source}`);
	const data = $.NSBitmapImageRep.alloc
		.initWithCGImage(cropped)
		.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
	if (!data.writeToFileAtomically(target, true)) throw new Error(`cannot write ${target}`);
}
