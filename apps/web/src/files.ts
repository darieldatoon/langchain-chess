// Files in and out of the browser: the imperative edge of import and export.

/** Saves `value` as a JSON download named `name`. */
export function downloadJson(name: string, value: unknown, doc: Document = document): void {
  const blob = new Blob([JSON.stringify(value, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** A file's JSON, or a message saying why it isn't JSON. */
export async function readJson(
  file: Blob,
): Promise<{ ok: true; value: unknown } | { ok: false; why: string }> {
  try {
    return { ok: true, value: JSON.parse(await file.text()) as unknown };
  } catch {
    return { ok: false, why: "That file isn't JSON." };
  }
}
