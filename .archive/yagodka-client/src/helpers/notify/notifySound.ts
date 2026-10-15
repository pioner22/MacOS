type NotificationSoundKind = "message" | "invite" | "auth" | "system";

let installedUnlock = false;
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

async function resumeAudioContext(ctx: AudioContext): Promise<boolean> {
  try {
    if (String(ctx.state) === "running") return true;
    await ctx.resume();
    return String(ctx.state) === "running";
  } catch {
    return String(ctx.state) === "running";
  }
}

export function installNotificationSoundUnlock(): void {
  if (installedUnlock) return;
  installedUnlock = true;

  const tryUnlock = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    void resumeAudioContext(ctx);
  };

  try {
    window.addEventListener("pointerdown", tryUnlock, { capture: true, once: true });
    window.addEventListener("touchstart", tryUnlock, { capture: true, once: true });
    window.addEventListener("keydown", tryUnlock, { capture: true, once: true });
  } catch {
    // ignore
  }
}

export async function playNotificationSound(kind: NotificationSoundKind = "message"): Promise<void> {
  const ctx = getAudioContext();
  if (!ctx) return;
  const ok = await resumeAudioContext(ctx);
  if (!ok) return;

  const freq = kind === "invite" ? 740 : kind === "auth" ? 660 : kind === "system" ? 520 : 880;
  const dur = kind === "system" ? 0.06 : 0.08;
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + dur + 0.01);
}
