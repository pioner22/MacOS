export type ReadScrollSnapshotInput = {
  curTop: number;
  curLeft: number;
  prevTop: number;
  prevLeft: number;
  prevAt: number;
  hasPrev: boolean;
  maxAgeMs: number;
  now?: number;
};

export function readScrollSnapshot(input: ReadScrollSnapshotInput): { top: number; left: number; usedPrev: boolean } {
  const now = typeof input.now === "number" ? input.now : Date.now();
  const age = now - input.prevAt;
  const ok = input.hasPrev && age >= 0 && age < input.maxAgeMs;
  if (ok) return { top: input.prevTop, left: input.prevLeft, usedPrev: true };
  return { top: input.curTop, left: input.curLeft, usedPrev: false };
}

