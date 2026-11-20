import "server-only";

import { PDF_PAGES_MAX, PDF_TEXT_MAX_CHARS } from "@/lib/reference-config";

/**
 * Text out of an uploaded PDF reference, once, at upload (unpdf: PDF.js's serverless build, no worker, no canvas).
 * At most PDF_PAGES_MAX pages and PDF_TEXT_MAX_CHARS characters are kept. Scanned PDFs have no text layer and come
 * back empty: agents are told so instead of getting nothing.
 */

export type PdfText = { text: string; pages: number; pagesRead: number; truncated: boolean };

export class PdfReadError extends Error {}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const { getDocumentProxy } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // A copy: PDF.js may transfer (detach) the buffer it gets. Text only: no XFA forms, and a damaged page is skipped.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { enableXfa: false, stopAtErrors: false });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new PdfReadError(name === "PasswordException" ? "This PDF is password-protected. Upload a copy without a password." : "We couldn't read this PDF.");
  }
  try {
    const pagesRead = Math.min(pdf.numPages, PDF_PAGES_MAX);
    const parts: string[] = [];
    let length = 0;
    for (let n = 1; n <= pagesRead && length < PDF_TEXT_MAX_CHARS; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      page.cleanup();
      if (text) {
        parts.push(`--- Page ${n} ---\n${text}`);
        length += text.length;
      }
    }
    const joined = parts.join("\n\n");
    const truncated = joined.length > PDF_TEXT_MAX_CHARS || pdf.numPages > pagesRead;
    // No text at all (a scan) stays empty, even with the page headers we'd add.
    const text = joined.length > PDF_TEXT_MAX_CHARS ? `${joined.slice(0, PDF_TEXT_MAX_CHARS)}\n… [text cut]` : joined;
    return { text: parts.length ? text : "", pages: pdf.numPages, pagesRead, truncated };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
