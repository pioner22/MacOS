export type RafScrollLock = {
  start: (top: number, left: number) => void;
  stop: () => void;
  isActive: () => boolean;
};

type RafCb = (time: number) => void;

export function createRafScrollLock(opts: {
  restore: (top: number, left: number) => void;
  requestAnimationFrame: (cb: RafCb) => number;
  cancelAnimationFrame: (id: number) => void;
}): RafScrollLock {
  let active = false;
  let rafId: number | null = null;
  let top = 0;
  let left = 0;

  const tick = (t: number) => {
    if (!active) {
      rafId = null;
      return;
    }
    opts.restore(top, left);
    rafId = opts.requestAnimationFrame(tick);
  };

  return {
    start: (nextTop: number, nextLeft: number) => {
      top = nextTop;
      left = nextLeft;
      active = true;
      opts.restore(top, left);
      if (rafId !== null) return;
      rafId = opts.requestAnimationFrame(tick);
    },
    stop: () => {
      active = false;
      if (rafId === null) return;
      opts.cancelAnimationFrame(rafId);
      rafId = null;
    },
    isActive: () => active,
  };
}

