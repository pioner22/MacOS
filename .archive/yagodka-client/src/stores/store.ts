export type Listener = () => void;

export class Store<TState> {
  private state: TState;
  private listeners = new Set<Listener>();

  constructor(initial: TState) {
    this.state = initial;
  }

  get(): TState {
    return this.state;
  }

  set(patch: Partial<TState> | ((prev: TState) => TState)) {
    const prev = this.state;
    const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
    if (Object.is(next, prev)) return;
    this.state = next;
    this.notify();
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
