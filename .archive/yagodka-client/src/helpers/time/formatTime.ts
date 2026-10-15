import { pad2 } from "./pad2";

export function formatTime(ts: number): string {
  try {
    const d = new Date(ts * 1000);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  } catch {
    return "??:??";
  }
}

