export async function copyText(text: string): Promise<boolean> {
  const value = String(text ?? "");
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // ignore
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.readOnly = true;
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("autocorrect", "off");
    ta.setAttribute("autocapitalize", "off");
    ta.setAttribute("spellcheck", "false");
    ta.setAttribute("inputmode", "none");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
