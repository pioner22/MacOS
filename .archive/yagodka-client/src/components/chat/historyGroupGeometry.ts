export type HistoryGroupRole = "single" | "start" | "middle" | "end";

export function resolveHistoryGroupRole(continues: boolean, tail: boolean): HistoryGroupRole {
  if (continues) return tail ? "end" : "middle";
  return tail ? "single" : "start";
}

export function applyHistoryGroupGeometry(line: HTMLElement, continues: boolean, tail: boolean): HistoryGroupRole {
  const role = resolveHistoryGroupRole(continues, tail);
  if (continues) line.classList.add("msg-cont");
  if (tail) line.classList.add("msg-tail");
  line.classList.add(`msg-group-${role}`);
  line.setAttribute("data-msg-group-role", role);
  return role;
}
