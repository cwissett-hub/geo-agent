// Render icons/icon.svg to icons/icon{16,32,48,128}.png in a headless Chromium
// on a CDP port (see dev/shot.mjs for how to start one).
//   node dev/render-icons.mjs [cdpPort=9444]
import { readFileSync, writeFileSync } from "node:fs";

const port = process.argv[2] || "9444";
const SIZES = [16, 32, 48, 128];
const svg = readFileSync(new URL("../icons/icon.svg", import.meta.url), "utf8");

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
const call = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id; waiting.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
await new Promise((r) => (ws.onopen = r));
const { targetId } = await call("Target.createTarget", { url: "about:blank" });
const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });

const expr = `(async () => {
  const img = new Image();
  img.src = "data:image/svg+xml;base64," + ${JSON.stringify(Buffer.from(svg).toString("base64"))};
  await img.decode();
  const out = {};
  for (const n of ${JSON.stringify(SIZES)}) {
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, n, n);
    out[n] = c.toDataURL("image/png").split(",")[1];
  }
  return JSON.stringify(out);
})()`;
const { result } = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
const pngs = JSON.parse(result.value);
for (const n of SIZES) {
  writeFileSync(new URL(`../icons/icon${n}.png`, import.meta.url), Buffer.from(pngs[n], "base64"));
  console.log(`icons/icon${n}.png`);
}
await call("Target.closeTarget", { targetId });
ws.close();
