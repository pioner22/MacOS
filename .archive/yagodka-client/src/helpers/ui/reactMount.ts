import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const roots = new WeakMap<HTMLElement, Root>();

export function renderReact(host: HTMLElement, node: ReactNode): void {
  let root = roots.get(host);
  if (!root) {
    root = createRoot(host);
    roots.set(host, root);
  }
  root.render(node);
}

export function unmountReact(host: HTMLElement): void {
  const root = roots.get(host);
  if (!root) return;
  root.unmount();
  roots.delete(host);
}

