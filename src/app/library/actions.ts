"use server";

import { requireOwner } from "@/lib/auth/access";
import { pdfUploadTarget } from "@/lib/library/book";

/** A one-off place for the browser to upload the PDF to, straight into private storage. */
export async function startPdfUpload(): Promise<{ path: string; token: string } | { error: string }> {
  await requireOwner();
  const target = await pdfUploadTarget();
  return target ?? { error: "Storage would not take an upload. Check that the library migration has been pushed." };
}
