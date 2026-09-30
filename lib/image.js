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
 * Layout for the car views (the player looking down at the Google car, front
 * and/or back) under the main screenshot. One view spans the full width; two
 * sit side by side, each half width. Views keep their aspect ratio, the row is
 * as tall as the taller one, and the whole stack is fitted within maxEdge.
 */
export function stackLayout(top, bottoms, maxEdge = MAX_EDGE) {
  const n = bottoms.length;
  const cellW = (top.width - STACK_GAP * (n - 1)) / n;
  const heights = bottoms.map((b) => b.height * (cellW / b.width));
  const rowH = Math.max(...heights);
  const full = { width: top.width, height: top.height + STACK_GAP + rowH };
  const { width, height, scale } = fitWithin(full.width, Math.round(full.height), maxEdge);
  const rowY = Math.round((top.height + STACK_GAP) * scale);
  return {
    width, height,
    top: { x: 0, y: 0, w: width, h: Math.round(top.height * scale) },
    bottoms: heights.map((h, i) => ({
      x: Math.round(i * (cellW + STACK_GAP) * scale),
      y: rowY,
      w: Math.round(cellW * scale),
      h: Math.min(Math.round(h * scale), height - rowY),
    })),
  };
}

/**
 * Browser only. Stacks the car views ({url, label}) under topUrl into one JPEG
 * data URL, writing each label (FRONT / BACK) in the corner of its view so the
 * model knows which end of the car it is looking at.
 */
export async function stackDataUrls(topUrl, views, maxEdge = MAX_EDGE) {
  const load = async (u) => createImageBitmap(await (await fetch(u)).blob());
  const a = await load(topUrl);
  const bs = await Promise.all(views.map((v) => load(v.url)));
  const L = stackLayout(a, bs, maxEdge);
  const canvas = new OffscreenCanvas(L.width, L.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#171235";
  ctx.fillRect(0, 0, L.width, L.height);
  ctx.drawImage(a, L.top.x, L.top.y, L.top.w, L.top.h);
  const size = Math.max(14, Math.round(L.width / 45));
  ctx.font = `bold ${size}px sans-serif`;
  ctx.textBaseline = "top";
  bs.forEach((b, i) => {
    const r = L.bottoms[i];
    ctx.drawImage(b, r.x, r.y, r.w, r.h);
    const label = `CAR ${views[i].label}`;
    const pad = Math.round(size / 3);
    ctx.fillStyle = "#000000b0";
    ctx.fillRect(r.x + pad, r.y + pad, ctx.measureText(label).width + pad * 2, size + pad * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, r.x + pad * 2, r.y + pad * 2);
  });
  a.close(); bs.forEach((b) => b.close());
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(out);
  });
}
