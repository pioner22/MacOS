export async function probeImageDimensions(blob: Blob): Promise<{ w: number | null; h: number | null }> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(blob);
      const w = Number(bmp?.width ?? 0);
      const h = Number(bmp?.height ?? 0);
      try {
        bmp?.close?.();
      } catch {
        // ignore
      }
      return {
        w: Number.isFinite(w) && w > 0 ? Math.trunc(w) : null,
        h: Number.isFinite(h) && h > 0 ? Math.trunc(h) : null,
      };
    }
  } catch {
    // ignore
  }

  return await new Promise((resolve) => {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(blob);
    } catch {
      url = null;
    }
    if (!url) {
      resolve({ w: null, h: null });
      return;
    }

    const img = new Image();
    const done = (w: number | null, h: number | null) => {
      try {
        URL.revokeObjectURL(url || "");
      } catch {
        // ignore
      }
      resolve({ w, h });
    };
    img.onload = () =>
      done(
        Math.trunc(Number(img.naturalWidth || img.width || 0) || 0) || null,
        Math.trunc(Number(img.naturalHeight || img.height || 0) || 0) || null
      );
    img.onerror = () => done(null, null);
    img.src = url;
  });
}
