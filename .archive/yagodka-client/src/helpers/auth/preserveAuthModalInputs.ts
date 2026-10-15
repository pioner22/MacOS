type ValueField = { value: string };

export function preserveAuthModalInputs(opts: {
  hadAuthModal: boolean;
  prev: { id: string; pw: string; pw1: string; pw2: string };
  next: { idEl: ValueField | null; pwEl: ValueField | null; pw1El: ValueField | null; pw2El: ValueField | null };
}): void {
  if (!opts.hadAuthModal) return;
  const { prev, next } = opts;
  if (next.idEl && next.idEl.value !== prev.id) next.idEl.value = prev.id;
  if (next.pwEl && next.pwEl.value !== prev.pw) next.pwEl.value = prev.pw;
  if (next.pw1El && next.pw1El.value !== prev.pw1) next.pw1El.value = prev.pw1;
  if (next.pw2El && next.pw2El.value !== prev.pw2) next.pw2El.value = prev.pw2;
}

