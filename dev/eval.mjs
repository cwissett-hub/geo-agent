// Evaluate an expression in a fresh headless tab: node dev/eval.mjs <url> "<expr>" [cdpPort=9444] [waitMs=1500]
const [url, expr, port = "9444", waitMs = "1500"] = process.argv.slice(2);
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0; const waiting = new Map();
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
await new Promise((r) => (ws.onopen = r));
const { targetId } = await call("Target.createTarget", { url: "about:blank" });
const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
await call("Page.enable", {}, sessionId);
await call("Page.navigate", { url }, sessionId);
await new Promise((r) => setTimeout(r, +waitMs));
const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
console.log(typeof r.result.value === "string" ? r.result.value : JSON.stringify(r.result.value ?? r, null, 1));
await call("Target.closeTarget", { targetId });
ws.close();
