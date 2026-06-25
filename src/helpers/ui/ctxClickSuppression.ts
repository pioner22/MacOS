export type CtxClickSuppressionState = {
  key: string | null;
  until: number;
};

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

function makeKey(kind: unknown, id: unknown): string | null {
  const k = norm(kind);
  const v = norm(id);
  if (!k || !v) return null;
  return `${k}:${v}`;
}

export function armCtxClickSuppression(state: CtxClickSuppressionState, kind: unknown, id: unknown, ms: number): CtxClickSuppressionState {
  const key = makeKey(kind, id);
  if (!key) return state;
  const delta = Number.isFinite(ms) ? Math.max(0, Math.trunc(ms)) : 0;
  return { key, until: Date.now() + delta };
}

export function consumeCtxClickSuppression(
  state: CtxClickSuppressionState,
  kind: unknown,
  id: unknown
): { suppressed: boolean; state: CtxClickSuppressionState } {
  const key = makeKey(kind, id);
  if (!key || !state.key || key !== state.key) return { suppressed: false, state };
  const suppressed = Date.now() <= state.until;
  return { suppressed, state: { key: null, until: 0 } };
}

