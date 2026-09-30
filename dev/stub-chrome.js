// Minimal chrome.* stub for previewing the side panel in a normal browser tab.
// Storage is in-memory; runtime.sendMessage answers "capture" with whatever the
// seed script put in window.__previewCaptureReply.
(function () {
  const mem = { session: {}, local: {} };
  function area(name) {
    return {
      async get(keys) {
        const store = mem[name];
        if (keys == null) return { ...store };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      async set(obj) { Object.assign(mem[name], obj); },
      async remove(keys) { for (const k of [].concat(keys)) delete mem[name][k]; },
    };
  }
  window.chrome = {
    storage: { session: area("session"), local: area("local") },
    runtime: {
      async sendMessage(msg) {
        if (msg.type === "capture" || msg.type === "analyse") {
          const make = window.__previewCaptureReply;
          return make ? make(msg) : { ok: false, error: { code: "capture", message: "preview: no capture reply configured" } };
        }
        // Car view: hand back the held round's own screenshot as the "car" shot.
        if (msg.type === "captureCar") {
          const { lastRound } = await area("session").get("lastRound");
          const img = document.querySelector(".shot img");
          return { ok: true, imageDataUrl: (lastRound && lastRound.imageDataUrl) || (img && img.src) };
        }
        return null;
      },
      onMessage: { addListener() {} },
      getURL(p) { return "../" + p; },
    },
    tabs: { async create(o) { window.open(o.url, "_blank"); }, async query() { return []; } },
  };
})();
