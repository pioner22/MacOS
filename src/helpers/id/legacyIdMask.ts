function isLegacyNumericCandidate(raw: string): boolean {
  return /^[0-9\s-]*$/.test(raw);
}

export function formatLegacyIdForInput(raw: string): string {
  const src = String(raw ?? "");
  if (!isLegacyNumericCandidate(src)) return src;
  const digits = src.replace(/\D/g, "");
  if (!digits) return "";
  const head = digits.slice(0, 3);
  const tail = digits.slice(3);
  if (!tail) return head;
  const parts: string[] = [head];
  for (let i = 0; i < tail.length; i += 3) {
    parts.push(tail.slice(i, i + 3));
  }
  return parts.join("-");
}

function cursorPosForDigitCount(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let count = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    const ch = formatted[i];
    if (ch >= "0" && ch <= "9") count += 1;
    if (count >= digitsBefore) return i + 1;
  }
  return formatted.length;
}

export function applyLegacyIdMask(input: HTMLInputElement): void {
  const prev = input.value;
  if (!isLegacyNumericCandidate(prev)) return;
  const selStart = typeof input.selectionStart === "number" ? input.selectionStart : prev.length;
  const digitsBefore = prev.slice(0, selStart).replace(/\D/g, "").length;
  const next = formatLegacyIdForInput(prev);
  if (next === prev) return;
  input.value = next;
  try {
    const pos = cursorPosForDigitCount(next, digitsBefore);
    input.setSelectionRange(pos, pos);
  } catch {
    // ignore
  }
}

