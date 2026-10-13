/**
 * Builders for real, minimal document files.
 *
 * The document extractors are tested against genuine bytes rather than a stubbed
 * library, so these helpers emit the smallest valid file for each format:
 * a one-page PDF, a ZIP-backed DOCX, and a ZIP-backed ODT. RTF is text and XLSX
 * is built with `exceljs` in its own test. Legacy `.doc` (OLE) cannot be
 * synthesized here.
 */

import { strToU8, zipSync } from "fflate";

/** A one-page PDF whose content stream draws `text` in Helvetica. */
export function buildPdf(text: string): Uint8Array {
	const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, index) => {
		offsets.push(pdf.length);
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return strToU8(pdf);
}

/** A DOCX whose body is the given paragraphs, one per `<w:p>`. */
export function buildDocx(paragraphs: string[]): Uint8Array {
	const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
	const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
	const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join("");
	const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
	return zipSync({
		"[Content_Types].xml": strToU8(contentTypes),
		"_rels/.rels": strToU8(rels),
		"word/document.xml": strToU8(document),
	});
}

/** An ODT whose `content.xml` body is `bodyXml` (e.g. `<text:p>…</text:p>`). */
export function buildOdt(bodyXml: string): Uint8Array {
	const document = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
<office:body><office:text>${bodyXml}</office:text></office:body></office:document-content>`;
	return zipSync({
		mimetype: strToU8("application/vnd.oasis.opendocument.text"),
		"content.xml": strToU8(document),
	});
}

/** An RTF document whose body is the given paragraphs. */
export function buildRtf(paragraphs: string[]): string {
	const body = paragraphs.map((p) => `${p}\\par`).join(" ");
	return `{\\rtf1\\ansi\\deff0 {\\fonttbl{\\f0 Times New Roman;}} \\f0 ${body}}`;
}
