export const MAX_EDGE = 1600;
export const IMAGE_SIZES = [1600, 1280, 1024];

export function fitWithin(width, height, maxEdge = MAX_EDGE) {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height, scale: 1 };
  const scale = maxEdge / long;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  };
}

/** Browser only. Shrinks a PNG/JPEG data URL to maxEdge on its long side and re-encodes as JPEG. */
export async function downscaleDataUrl(dataUrl, maxEdge = MAX_EDGE) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(out);
  });
}

export const STACK_GAP = 6;

/**
 * Layout for stacking a second view (the Google car, looking down) under the
 * main screenshot: the bottom image is scaled to the top image's width, with a
 * dark gap between them, then the whole stack is fitted within maxEdge.
 */
export function stackLayout(top, bottom, maxEdge = MAX_EDGE) {
  const bottomH = Math.round(bottom.height * (top.width / bottom.width));
  const full = { width: top.width, height: top.height + STACK_GAP + bottomH };
  const { width, height, scale } = fitWithin(full.width, full.height, maxEdge);
  return {
    width, height,
    top: { x: 0, y: 0, w: width, h: Math.round(top.height * scale) },
    bottom: { x: 0, y: Math.round((top.height + STACK_GAP) * scale), w: width, h: height - Math.round((top.height + STACK_GAP) * scale) },
  };
}

/** Browser only. Stacks bottomUrl under topUrl into one JPEG data URL. */
export async function stackDataUrls(topUrl, bottomUrl, maxEdge = MAX_EDGE) {
  const [a, b] = await Promise.all([topUrl, bottomUrl].map(async (u) => createImageBitmap(await (await fetch(u)).blob())));
  const L = stackLayout(a, b, maxEdge);
  const canvas = new OffscreenCanvas(L.width, L.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#171235";
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.drawImage(a, L.top.x, L.top.y, L.top.w, L.top.h);
  ctx.drawImage(b, L.bottom.x, L.bottom.y, L.bottom.w, L.bottom.h);
  a.close(); b.close();
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(out);
  });
}
