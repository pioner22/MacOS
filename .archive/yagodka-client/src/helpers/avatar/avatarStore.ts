export type AvatarTargetKind = "dm" | "group" | "board";
export type AvatarUploadMime = "image/png" | "image/jpeg" | "image/webp";

const STORAGE_PREFIX = "yagodka_avatar:";
const REV_PREFIX = "yagodka_avatar_rev:";
const MAX_DATA_URL_LEN = 220_000;
const MEM_CACHE_MAX = 250;
const MAX_AVATAR_UPLOAD_BYTES = 45 * 1024;

const memAvatar = new Map<string, string>();
const memRev = new Map<string, number>();

function key(kind: AvatarTargetKind, id: string): string {
  return `${STORAGE_PREFIX}${kind}:${String(id ?? "").trim()}`;
}

function revKey(kind: AvatarTargetKind, id: string): string {
  return `${REV_PREFIX}${kind}:${String(id ?? "").trim()}`;
}

function memKey(kind: AvatarTargetKind, id: string): string {
  return `${kind}:${String(id ?? "").trim()}`;
}

function touchMem<K, V>(map: Map<K, V>, k: K, v: V) {
  map.delete(k);
  map.set(k, v);
  if (map.size <= MEM_CACHE_MAX) return;
  const oldest = map.keys().next().value as K | undefined;
  if (oldest !== undefined) map.delete(oldest);
}

function isSafeDataUrl(value: string): boolean {
  if (!value) return false;
  if (value.length > MAX_DATA_URL_LEN) return false;
  return value.startsWith("data:image/");
}

function base64DecodedSize(value: string): number {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean) return 0;
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function avatarUploadMime(value: string): AvatarUploadMime | null {
  const clean = String(value || "").trim().toLowerCase();
  if (clean === "image/png" || clean === "image/jpeg" || clean === "image/webp") return clean;
  return null;
}

export function avatarDataUrlToUploadPayload(dataUrl: string): {
  mime: AvatarUploadMime;
  base64: string;
  bytes: number;
} {
  const raw = String(dataUrl || "").trim();
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  if (!match) throw new Error("bad_avatar_data");
  const mime = avatarUploadMime(match[1] || "");
  if (!mime) throw new Error("bad_avatar_mime");
  const base64 = String(match[2] || "").replace(/\s+/g, "");
  if (!base64) throw new Error("bad_avatar_data");
  const bytes = base64DecodedSize(base64);
  if (!bytes || bytes > MAX_AVATAR_UPLOAD_BYTES) throw new Error("avatar_transport_too_large");
  return { mime, base64, bytes };
}

function evictStoredAvatarData(exceptStorageKey: string) {
  try {
    if (typeof localStorage === "undefined") return;
    if (typeof (localStorage as any).key !== "function") return;
    if (typeof (localStorage as any).length !== "number") return;
    const keys: string[] = [];
    for (let i = 0; i < (localStorage as any).length; i += 1) {
      const k = (localStorage as any).key(i);
      if (typeof k !== "string") continue;
      if (!k.startsWith(STORAGE_PREFIX)) continue;
      if (k === exceptStorageKey) continue;
      keys.push(k);
    }
    for (const k of keys) {
      try {
        localStorage.removeItem(k);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

export function getStoredAvatar(kind: AvatarTargetKind, id: string): string | null {
  const k = key(kind, id);
  const mk = memKey(kind, id);
  const mv = memAvatar.get(mk);
  if (mv && isSafeDataUrl(mv)) return mv;
  try {
    const v = String(localStorage.getItem(k) || "");
    return isSafeDataUrl(v) ? v : null;
  } catch {
    return null;
  }
}

export function getStoredAvatarRev(kind: AvatarTargetKind, id: string): number {
  const k = revKey(kind, id);
  const mk = memKey(kind, id);
  const mv = memRev.get(mk);
  if (typeof mv === "number" && mv > 0) return mv;
  try {
    const raw = String(localStorage.getItem(k) || "").trim();
    const n = Math.trunc(Number(raw || 0) || 0);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function storeAvatarRev(kind: AvatarTargetKind, id: string, rev: number): void {
  const k = revKey(kind, id);
  const n = Math.max(0, Math.trunc(Number(rev || 0) || 0));
  touchMem(memRev, memKey(kind, id), n);
  try {
    localStorage.setItem(k, String(n));
  } catch {
    // ignore
  }
}

export function storeAvatar(kind: AvatarTargetKind, id: string, dataUrl: string): void {
  const v = String(dataUrl ?? "");
  if (!isSafeDataUrl(v)) throw new Error("bad_avatar_data");
  const k = key(kind, id);
  try {
    localStorage.setItem(k, v);
    memAvatar.delete(memKey(kind, id));
  } catch {
    try {
      evictStoredAvatarData(k);
      localStorage.setItem(k, v);
      memAvatar.delete(memKey(kind, id));
    } catch {
      touchMem(memAvatar, memKey(kind, id), v);
    }
  }
}

export function clearStoredAvatar(kind: AvatarTargetKind, id: string): void {
  memAvatar.delete(memKey(kind, id));
  memRev.delete(memKey(kind, id));
  try {
    localStorage.removeItem(key(kind, id));
    localStorage.removeItem(revKey(kind, id));
  } catch {
    // ignore
  }
}

export function avatarMonogram(kind: AvatarTargetKind, id: string): string {
  const raw = String(id ?? "").trim();
  if (kind === "group") return "G";
  if (kind === "board") return "B";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 2) return digits.slice(-2);
  if (digits.length === 1) return digits;
  return raw.slice(0, 2).toUpperCase() || "—";
}

export function avatarHue(seed: string): number {
  const s = String(seed ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) % 360;
  }
  return h;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: AvatarUploadMime, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob((blob) => resolve(blob || null), mime, quality);
        return;
      }
    } catch {
      // ignore
    }
    resolve(null);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("avatar_read_failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(error);
    }
  });
}

function makeAvatarCanvas(source: CanvasImageSource, size: number, opaque = false): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const target = Math.max(32, Math.min(256, Math.trunc(size || 0) || 128));
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_canvas");
  if (opaque) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, target, target);
  }
  const sw = Number((source as { width?: number }).width || 0) || target;
  const sh = Number((source as { height?: number }).height || 0) || target;
  ctx.drawImage(source, 0, 0, sw, sh, 0, 0, target, target);
  return canvas;
}

async function exportAvatarDataUrl(canvas: HTMLCanvasElement, mime: AvatarUploadMime, quality?: number): Promise<string> {
  const blob = await canvasToBlob(canvas, mime, quality);
  if (blob && blob.size > 0) {
    return blobToDataUrl(blob);
  }
  return canvas.toDataURL(mime, quality);
}

export async function imageFileToAvatarDataUrl(file: File, size = 128): Promise<string> {
  if (!file) throw new Error("no_file");
  const mime = String(file.type ?? "").trim().toLowerCase();
  const name = String((file as any).name ?? "").trim();
  const isNameImage = Boolean(name && /\.(png|jpe?g|gif|webp|bmp|ico|svg|heic|heif|jfif|avif)$/i.test(name));
  const isMimeImage = Boolean(mime && mime.startsWith("image/"));
  if (!isMimeImage && !isNameImage) throw new Error("not_image");
  if (file.size > 6 * 1024 * 1024) throw new Error("file_too_large");

  const srcUrl = URL.createObjectURL(file);
  let bitmap: ImageBitmap | null = null;
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      try {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => resolve(null);
        i.src = srcUrl;
      } catch {
        resolve(null);
      }
    });

    bitmap = await (async () => {
      if (img) {
        const sw = img.naturalWidth || img.width || 0;
        const sh = img.naturalHeight || img.height || 0;
        if (sw > 0 && sh > 0) return null;
      }
      try {
        const fn = (globalThis as any).createImageBitmap;
        if (typeof fn !== "function") return null;
        const b = await fn(file);
        return b as ImageBitmap;
      } catch {
        return null;
      }
    })();

    const source: CanvasImageSource | null = bitmap || img;
    const sw = bitmap ? bitmap.width : img ? img.naturalWidth || img.width || 0 : 0;
    const sh = bitmap ? bitmap.height : img ? img.naturalHeight || img.height || 0 : 0;
    if (!source || !sw || !sh) throw new Error("image_load_failed");

    const side = Math.min(sw, sh);
    const sx = Math.floor((sw - side) / 2);
    const sy = Math.floor((sh - side) / 2);

    const target = Math.max(48, Math.min(256, Math.floor(size || 128)));
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no_canvas");
    ctx.drawImage(source, sx, sy, side, side, 0, 0, target, target);

    const sizeCandidates = Array.from(
      new Set([target, Math.min(target, 112), Math.min(target, 96), Math.min(target, 80), Math.min(target, 64)])
    ).filter((value) => value > 0);
    const formatAttempts: Array<{ mime: AvatarUploadMime; quality?: number; opaque?: boolean }> = [
      { mime: "image/webp", quality: 0.82 },
      { mime: "image/jpeg", quality: 0.86, opaque: true },
      { mime: "image/webp", quality: 0.72 },
      { mime: "image/jpeg", quality: 0.74, opaque: true },
      { mime: "image/png" },
    ];

    let lastError: Error | null = null;
    for (const candidateSize of sizeCandidates) {
      const scaledCanvas = candidateSize === target ? canvas : makeAvatarCanvas(canvas, candidateSize, false);
      for (const attempt of formatAttempts) {
        try {
          const exportCanvas = attempt.opaque ? makeAvatarCanvas(scaledCanvas, candidateSize, true) : scaledCanvas;
          const dataUrl = await exportAvatarDataUrl(exportCanvas, attempt.mime, attempt.quality);
          avatarDataUrlToUploadPayload(dataUrl);
          return dataUrl;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error || "avatar_export_failed"));
        }
      }
    }
    throw lastError || new Error("avatar_transport_too_large");
  } finally {
    try {
      bitmap?.close();
    } catch {
      // ignore
    }
    URL.revokeObjectURL(srcUrl);
  }
}
