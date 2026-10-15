export function insertTextAtSelection(opts: {
  value: string;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  insertText: string;
}): { value: string; caret: number } {
  const value = String(opts.value ?? "");
  const insertText = String(opts.insertText ?? "");
  const maxPos = value.length;
  const startRaw = typeof opts.selectionStart === "number" ? opts.selectionStart : maxPos;
  const endRaw = typeof opts.selectionEnd === "number" ? opts.selectionEnd : startRaw;

  const start = Math.max(0, Math.min(maxPos, startRaw));
  const end = Math.max(0, Math.min(maxPos, endRaw));
  const a = Math.min(start, end);
  const b = Math.max(start, end);

  const next = value.slice(0, a) + insertText + value.slice(b);
  return { value: next, caret: a + insertText.length };
}
