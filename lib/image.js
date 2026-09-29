export const MAX_EDGE = 1600;

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
