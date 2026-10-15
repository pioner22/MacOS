export function autosizeInput(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const style = window.getComputedStyle(el);
  const max = Number.parseFloat(style.maxHeight || "");
  const next = el.scrollHeight;
  const height = Number.isFinite(max) && max > 0 ? Math.min(next, max) : next;
  el.style.height = `${Math.max(0, Math.ceil(height))}px`;

  const maxed = Number.isFinite(max) && max > 0 ? next > max + 1 : false;
  el.classList.toggle("input-maxed", maxed);

  if (!maxed) return;
  try {
    const ss = typeof el.selectionStart === "number" ? el.selectionStart : null;
    const se = typeof el.selectionEnd === "number" ? el.selectionEnd : null;
    const atEnd = ss !== null && se !== null && ss === se && se >= Math.max(0, el.value.length - 1);
    if (atEnd) el.scrollTop = el.scrollHeight;
  } catch {
    // ignore
  }
}

