export function isMobileLikeUi(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia !== "function") return false;
    return Boolean(
      window.matchMedia("(max-width: 600px)").matches ||
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(any-pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches
    );
  } catch {
    return false;
  }
}
