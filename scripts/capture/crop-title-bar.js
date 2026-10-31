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
 *   osascript -l JavaScript scripts/capture/crop-title-bar.js <source> <target> <window width in points> <title bar in points> <frame canvas #rrggbb>
 *
 * `CGImageCreateWithImageInRect` measures from the image's top-left corner, which
 * is the strip to remove; the capture is in device pixels, so the point
 * measurements are scaled by the capture's width. The first row left behind has
 * to be the frame's canvas: the title bar's bottom edge is lighter than the
 * terminal, and a crop that stops above it ships a bright seam down the top of
 * every frame.
 */

ObjC.import("AppKit");
ObjC.import("ImageIO");

function run(argv) {
	const [source, target, windowWidth, titleBar, canvas] = argv;
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
	const bitmap = $.NSBitmapImageRep.alloc.initWithCGImage(cropped);
	assertCanvasTop(bitmap, canvas, target);
	const data = bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
	if (!data.writeToFileAtomically(target, true)) throw new Error(`cannot write ${target}`);
}

/** The three 0-255 channels of a `#rrggbb` colour. */
function channels(hex) {
	const match = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!match) throw new Error(`cannot read ${hex} as a #rrggbb colour`);
	return [0, 2, 4].map(function (at) {
		return Number.parseInt(match[1].slice(at, at + 2), 16);
	});
}

/**
 * Fail rather than ship a frame with the title bar's edge still on it.
 *
 * Nothing else can check this: the crop only runs on a machine with a real
 * Terminal window, and the pictures it writes are compared by eye. So the row
 * the crop lands on is measured here. A frame's first row is canvas between its
 * glyphs, while the bar's edge is one flat lighter colour, so most of that row
 * has to be the canvas — and a bar that grew again stops the capture with a
 * colour it left behind. Colours are read through the capture's display profile,
 * which rounds the same canvas to a few neighbouring values, hence `near`.
 */
function assertCanvasTop(bitmap, canvasHex, target) {
	const canvas = channels(canvasHex);
	let canvasPixels = 0;
	let samples = 0;
	let left;
	for (let x = 0; x < bitmap.pixelsWide; x += 4) {
		const colour = bitmap.colorAtXY(x, 0);
		const found = [colour.redComponent, colour.greenComponent, colour.blueComponent].map(channel);
		samples += 1;
		if (near(found, canvas)) canvasPixels += 1;
		else if (left === undefined) left = found;
	}
	if (canvasPixels * 2 > samples) return;
	throw new Error(
		`the title bar crop left ${left === undefined ? "no canvas" : hexOf(left)} at row 0 of ${target}, not the frame canvas ${canvasHex}: raise TITLE_BAR_POINTS in scripts/capture/terminal.ts`,
	);
}

/** Whether two 0-255 colours are the same to within a rounding step. */
function near(left, right) {
	for (let at = 0; at < left.length; at++) {
		if (Math.abs(left[at] - right[at]) > 3) return false;
	}
	return true;
}

/** A 0-255 colour as `#rrggbb`. */
function hexOf(rgb) {
	return `#${rgb.map(byte).join("")}`;
}

/** A colour component as 0-255. */
function channel(value) {
	return Math.round(value * 255);
}

/** A 0-255 channel as two hex digits. */
function byte(value) {
	return value.toString(16).padStart(2, "0");
}
