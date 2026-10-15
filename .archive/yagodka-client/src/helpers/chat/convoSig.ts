export function convoSig(msgs: any[]): string {
  const last = msgs && msgs.length ? msgs[msgs.length - 1] : null;
  const lastKey = last ? String((last.id ?? last.ts ?? "") as any) : "";
  return `${msgs?.length || 0}:${lastKey}`;
}

