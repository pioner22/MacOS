type SidebarScrollSnapshot = {
  left: number;
  top: number;
};

const readFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const maxScrollTopFor = (body: HTMLElement, fallback: number): number => {
  const scrollHeight = readFiniteNumber((body as any).scrollHeight, -1);
  const clientHeight = readFiniteNumber((body as any).clientHeight, -1);
  if (scrollHeight <= 0 || clientHeight <= 0) return Math.max(0, fallback);
  return Math.max(0, scrollHeight - clientHeight);
};

const maxScrollLeftFor = (body: HTMLElement, fallback: number): number => {
  const scrollWidth = readFiniteNumber((body as any).scrollWidth, -1);
  const clientWidth = readFiniteNumber((body as any).clientWidth, -1);
  if (scrollWidth <= 0 || clientWidth <= 0) return Math.max(0, fallback);
  return Math.max(0, scrollWidth - clientWidth);
};

export function captureSidebarScroll(body: HTMLElement): SidebarScrollSnapshot {
  return {
    left: Math.max(0, readFiniteNumber((body as any).scrollLeft, 0)),
    top: Math.max(0, readFiniteNumber((body as any).scrollTop, 0)),
  };
}

export function applySidebarScroll(body: HTMLElement, snapshot: SidebarScrollSnapshot): void {
  try {
    body.scrollTop = Math.min(Math.max(0, snapshot.top), maxScrollTopFor(body, snapshot.top));
    body.scrollLeft = Math.min(Math.max(0, snapshot.left), maxScrollLeftFor(body, snapshot.left));
  } catch {
    // ignore
  }
}

export function scheduleSidebarScrollRestore(body: HTMLElement, snapshot: SidebarScrollSnapshot): void {
  try {
    window.requestAnimationFrame(() => applySidebarScroll(body, snapshot));
  } catch {
    // ignore
  }
}

export function preserveSidebarScrollDuring(body: HTMLElement, reset: boolean, render: () => void): void {
  const snapshot = reset ? { left: 0, top: 0 } : captureSidebarScroll(body);
  render();
  applySidebarScroll(body, snapshot);
  scheduleSidebarScrollRestore(body, snapshot);
}
