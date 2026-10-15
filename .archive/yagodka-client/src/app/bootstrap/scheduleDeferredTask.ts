export function scheduleDeferredTask(task: () => void): void {
  if (typeof window === "undefined") {
    queueMicrotask(task);
    return;
  }
  const requestIdle = (window as any).requestIdleCallback;
  if (typeof requestIdle === "function") {
    requestIdle(() => task(), { timeout: 1200 });
    return;
  }
  window.setTimeout(task, 0);
}
