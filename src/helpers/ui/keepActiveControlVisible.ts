export function keepActiveControlVisible(root: { querySelector?: (selector: string) => unknown } | null | undefined, selector: string): void {
  const active = root && typeof root.querySelector === "function" ? root.querySelector(selector) : null;
  if (!active || typeof (active as { scrollIntoView?: unknown }).scrollIntoView !== "function") return;
  const scrollIntoView = (active as { scrollIntoView: (options?: unknown) => void }).scrollIntoView.bind(active);
  try {
    scrollIntoView({ block: "nearest", inline: "center" });
  } catch {
    try {
      scrollIntoView();
    } catch {
      // ignore scrollIntoView failures in constrained runtimes/tests
    }
  }
}
