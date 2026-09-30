// Screenshot a URL in a headless Chromium exposed on a CDP port.
// node dev/shot.mjs <url> <width> <height> <out.png> [cdpPort=9444] [fullPage=1]
import { writeFileSync } from "node:fs";

const [url, w, h, out, port = "9444", fullPage = "1"] = process.argv.slice(2);
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const browser = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
const call = (ws, method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id; waiting.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params, sessionId }));
});
const errors = [];
browser.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
};
await new Promise((r) => (browser.onopen = r));
const { targetId } = await call(browser, "Target.createTarget", { url: "about:blank" });
const { sessionId } = await call(browser, "Target.attachToTarget", { targetId, flatten: true });
const s = (m, p) => call(browser, m, p, sessionId);
await s("Runtime.enable"); await s("Page.enable");
await s("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
await s("Page.navigate", { url });
await new Promise((r) => setTimeout(r, +(process.env.SHOT_WAIT || 1800)));
// SHOT_JS: optional script run in the page before the screenshot (clicks etc.).
if (process.env.SHOT_JS) {
  await s("Runtime.evaluate", { expression: process.env.SHOT_JS, awaitPromise: true });
  await new Promise((r) => setTimeout(r, 800));
}
let clip;
if (fullPage === "1") {
  const { cssContentSize } = await s("Page.getLayoutMetrics");
  const height = Math.min(Math.ceil(cssContentSize.height), 6000);
  await s("Emulation.setDeviceMetricsOverride", { width: +w, height, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 300));
}
const shot = await s("Page.captureScreenshot", { format: "png", clip });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log(out, errors.length ? "ERRORS: " + JSON.stringify(errors) : "no console errors");
await call(browser, "Target.closeTarget", { targetId });
browser.close();
