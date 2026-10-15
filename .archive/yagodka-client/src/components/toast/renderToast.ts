import type { ToastState } from "../../stores/types";

export function renderToast(host: HTMLElement, toast: ToastState | null): void {
  void toast;
  const hostKey = host as HTMLElement & { __toastKey?: string };
  host.classList.add("hidden");
  host.removeAttribute("data-toast-placement");
  hostKey.__toastKey = "";
  host.replaceChildren();
}
